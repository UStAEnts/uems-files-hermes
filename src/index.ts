import { _ml, setupGlobalLogger } from './logging/Log';

setupGlobalLogger();
const __ = _ml(__filename);

import fs from 'fs/promises';
import path from 'path';
import * as z from 'zod';
import { FileDatabase } from "./database/FileDatabase";
import bind from "./Binding";
import {FileMessage as EM, FileResponse as ER, FileMessageValidator, FileResponseValidator} from "@uems/uemscommlib";
import {RabbitNetworkHandler} from '@uems/micro-builder';
import { ConfigurationSchema } from "./ConfigurationTypes";
import { LocalUploadServer, UploadServerInterface } from "./uploader/UploadServer";
import { FileBindingValidators } from "@uems/uemscommlib/build/filebinding/FileBindingValidators";
import FileBindingMessageValidator = FileBindingValidators.FileBindingMessageValidator;
import FileBindingResponseValidator = FileBindingValidators.FileBindingResponseValidator;

__.info('starting hermes...');

let messager: RabbitNetworkHandler<any, any, any, any, any, any> | undefined;
let database: FileDatabase | undefined;
let configuration: z.infer<typeof ConfigurationSchema> | undefined;
let uploader: UploadServerInterface;

fs.readFile(path.join(__dirname, '..', 'config', 'configuration.json'), { encoding: 'utf8' })
    .then((file) => {
        __.debug('loaded configuration file');

        configuration = ConfigurationSchema.parse(JSON.parse(file));
    })
    .then(async () => {
        if (!configuration) {
            __.error('reached an uninitialised configuration, this should not be possible');
            throw new Error('uninitialised configuration');
        }

        __.info('launching upload server');

        uploader = new LocalUploadServer(configuration.upload);
        await uploader.launch();
    })
    .then(() => (new Promise<FileDatabase>((resolve, reject) => {
        if (!configuration) {
            __.error('reached an uninitialised configuration, this should not be possible');
            reject(new Error('uninitialised configuration'));
            return;
        }

        __.info('setting up database connection');

        database = new FileDatabase(configuration.database, uploader);

        const unbind = database.once('error', (err) => {
            __.error('failed to setup the database connection', {
                error: err,
            });

            reject(err);
        });

        database.once('ready', () => {
            __.info('database connection enabled');
            // Make sure we dont later try and reject a resolved promise from an unrelated error
            unbind();

            if (database) resolve(database);
            else reject(new Error('database is invalid'));
        });
    })))
    .then(() => (new Promise<void>((resolve, reject) => {
        if (!configuration) {
            __.error('reached an uninitialised configuration, this should not be possible');
            reject(new Error('uninitialised configuration'));
            return;
        }

        __.info('setting up the message broker');

        const fileMessageValidator = new FileMessageValidator();
        const fileResponseValidator = new FileResponseValidator();
        const fileBindingMessageValidator = new FileBindingMessageValidator();
        const fileBindingResponseValidator = new FileBindingResponseValidator();

        const validateIncoming = async (data: any) => {
            const file = await fileMessageValidator.validate(data);
            if (file) return true;

            return fileBindingMessageValidator.validate(data);
        }

        const validateOutgoing = async (data: any) => {
            const file = await fileResponseValidator.validate(data);
            if (file) return true;

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
            // TODO: why a new one each call?
            validateIncoming,
            validateOutgoing,
        );

        const unbind = messager.once('error', (err) => {
            __.error('failed to setup the message broker', {
                error: err,
            });

            reject(err);
        });

        messager.once('ready', () => {
            __.info('message broker enabled');
            // Make sure we dont later try and reject a resolved promise from an unrelated error
            unbind();
            resolve();
        });
    })))
    .then(async () => {
        if (!messager || !database || !configuration) {
            __.error('reached an uninitialised database or messenger, this should not be possible');
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
