import { _ml, setupGlobalLogger } from './logging/Log';

setupGlobalLogger();
const __ = _ml(__filename);

import fs from 'fs/promises';
import path from 'path';
import * as z from 'zod';
import { FileDatabase } from "./database/FileDatabase";
import bind from "./Binding";
import { FileMessage as EM, FileResponse as ER, FileMessageValidator, FileResponseValidator, FileBindingMessageValidator, FileBindingResponseValidator, has } from "@uems/uemscommlib";
import { launchCheck, RabbitNetworkHandler, tryApplyTrait } from '@uems/micro-builder/build/src';
import { ConfigurationSchema } from "./ConfigurationTypes";
import { LocalUploadServer, UploadServerInterface } from "./uploader/UploadServer";

__.info('starting hermes...');

launchCheck(['successful', 'errored', 'rabbitmq', 'database', 'config'], (traits: Record<string, any>) => {
    if (has(traits, 'rabbitmq') && traits.rabbitmq !== '_undefined' && !traits.rabbitmq) return 'unhealthy';
    if (has(traits, 'database') && traits.database !== '_undefined' && !traits.database) return 'unhealthy';
    if (has(traits, 'config') && traits.config !== '_undefined' && !traits.config) return 'unhealthy';

    // If 75% of results fail then we return false
    if (has(traits, 'successful') && has(traits, 'errored')) {
        const errorPercentage = traits.errored / (traits.successful + traits.errored);
        if (errorPercentage > 0.05) return 'unhealthy-serving';
    }

    return 'healthy';
});

let messager: RabbitNetworkHandler<any, any, any, any, any, any> | undefined;
let database: FileDatabase | undefined;
let configuration: z.infer<typeof ConfigurationSchema> | undefined;
let uploader: UploadServerInterface;

fs.readFile(process.env.UEMS_HERMES_CONFIG_LOCATION ?? path.join(__dirname, '..', '..', 'config', 'configuration.json'), { encoding: 'utf8' })
    .then((file) => {
        __.debug('loaded configuration file');

        configuration = ConfigurationSchema.parse(JSON.parse(file));
    })
    .then(async () => {
        if (!configuration) {
            __.error('reached an uninitialised configuration, this should not be possible');
            tryApplyTrait('config', false);
            throw new Error('uninitialised configuration');
        }

        __.info('launching upload server');
        tryApplyTrait('config', true);

        uploader = new LocalUploadServer(configuration.upload);
        await uploader.launch();
    })
    .then(() => (new Promise<FileDatabase>((resolve, reject) => {
        if (!configuration) {
            __.error('reached an uninitialised configuration, this should not be possible');
            reject(new Error('uninitialised configuration'));
            tryApplyTrait('config', false);
            return;
        }

        __.info('setting up database connection');

        database = new FileDatabase(configuration.database, uploader);

        const unbind = database.once('error', (err) => {
            __.error('failed to setup the database connection', {
                error: err,
            });
            tryApplyTrait('database', false);

            reject(err);
        });

        database.once('ready', () => {
            __.info('database connection enabled');
            // Make sure we dont later try and reject a resolved promise from an unrelated error
            unbind();

            if (database) {
                resolve(database);
                tryApplyTrait('database', true);
            }else {
                reject(new Error('database is invalid'));
                tryApplyTrait('database', false);
            }
        });
    })))
    .then(() => (new Promise<void>((resolve, reject) => {
        if (!configuration) {
            __.error('reached an uninitialised configuration, this should not be possible');
            reject(new Error('uninitialised configuration'));
            tryApplyTrait('config', false);
            return;
        }

        __.info('setting up the message broker');

        const fileMessageValidator = new FileMessageValidator();
        const fileResponseValidator = new FileResponseValidator();
        const fileBindingMessageValidator = new FileBindingMessageValidator();
        const fileBindingResponseValidator = new FileBindingResponseValidator();

        const validateIncoming = async (data: any) => {
            __.debug('trying to process');
            const file = await fileMessageValidator.validate(data);
            if (file) return true;

            __.debug(`message ${data.msg_id} failed file message validator, trying binding`);
            return fileBindingMessageValidator.validate(data);
        }

        const validateOutgoing = async (data: any) => {
            const file = await fileResponseValidator.validate(data);
            if (file) return true;

            __.debug(`message ${data.msg_id} failed file response validator, trying binding`);

            return fileBindingResponseValidator.validate(data);
        }

        messager = new RabbitNetworkHandler<EM.FileMessage,
            EM.CreateFileMessage,
            EM.DeleteFileMessage,
            EM.ReadFileMessage,
            EM.UpdateFileMessage,
            ER.FileServiceReadResponseMessage | ER.FileResponseMessage>
        (
            configuration.message,
            validateIncoming,
            validateOutgoing,
        );

        const unbind = messager.once('error', (err) => {
            __.error('failed to setup the message broker', {
                error: err,
            });
            tryApplyTrait('rabbitmq', false);

            reject(err);
        });

        messager.once('ready', () => {
            __.info('message broker enabled');
            // Make sure we dont later try and reject a resolved promise from an unrelated error
            unbind();
            tryApplyTrait('rabbitmq', true);
            resolve();
        });
    })))
    .then(async () => {
        if (!messager || !database || !configuration) {
            __.error('reached an uninitialised database or messenger, this should not be possible');
            tryApplyTrait('database', false);
            tryApplyTrait('rabbitmq', false);
            throw new Error('uninitialised database or messenger');
        }

        __.info('binding database to messenger');

        bind(database, messager);

        // We're ready to start!
        __.info('hermes up and running');
    })
    .catch((err) => {
        __.error('failed to launch', {
            error: err as unknown,
        });
    });
