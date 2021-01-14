import { constants } from "http2";
import { FileDatabase } from "./database/FileDatabase";
import { _ml } from "./logging/Log";
import { RabbitNetworkHandler } from "@uems/micro-builder";
import { FileBindingMessage, FileBindingResponse, FileMessage, FileResponse, MsgStatus } from "@uems/uemscommlib";
import { FileValidators } from "@uems/uemscommlib/build/file/FileValidators";
import ShallowFileRepresentation = FileValidators.ShallowFileRepresentation;
import BindFilesToEventMessage = FileBindingMessage.BindFilesToEventMessage;
import BindEventsToFileMessage = FileBindingMessage.BindEventsToFileMessage;
import QueryByEventMessage = FileBindingMessage.QueryByEventMessage;
import QueryByFileMessage = FileBindingMessage.QueryByFileMessage;
import UnbindFilesFromEventMessage = FileBindingMessage.UnbindFilesFromEventMessage;
import UnbindEventsFromFileMessage = FileBindingMessage.UnbindEventsFromFileMessage;
import SetFilesForEventMessage = FileBindingMessage.SetFilesForEventMessage;
import SetEventsForFileMessage = FileBindingMessage.SetEventsForFileMessage;
import { ClientFacingError } from "@uems/micro-builder/build/errors/ClientFacingError";

const _b = _ml(__filename, 'binding');

async function handleBinding(
    message: FileBindingMessage.FileBindingMessage,
    database: FileDatabase | undefined,
    send: (res: FileBindingResponse.FileBindingResponse) => void,
) {
    if (!database) {
        _b.warn('query was received without a valid database connection');
        throw new Error('uninitialised database connection');
    }

    // @ts-ignore
    const rejection: FileBindingResponse.FileBindingResponse = {
        userID: message.userID,
        msg_intention: message.msg_intention,
        msg_id: message.msg_id,
        status: 405,
        result: ['invalid message structure'],
    };

    const acceptPartial: Omit<FileBindingResponse.FileBindingResponse, 'result' | 'status'> = {
        userID: message.userID,
        msg_intention: message.msg_intention,
        msg_id: message.msg_id,
    }

    // Due to some weird typescript bullshit I can't figure out we need to do some hacks to make this work
    // It won't let me check for a value on them because they have no shared types

    try {
        if (message.msg_intention === 'CREATE') {
            if (message.hasOwnProperty('eventID')) {
                const m = message as BindFilesToEventMessage;
                const r = await database.addFilesToEvents(m.eventID, m.fileIDs);

                send({
                    ...acceptPartial,
                    msg_intention: message.msg_intention,
                    status: r ? 200 : 405,
                    result: r,
                });
            } else if (message.hasOwnProperty('fileID')) {
                const m = message as BindEventsToFileMessage;
                const r = await database.addEventsToFile(m.fileID, m.eventIDs);

                send({
                    ...acceptPartial,
                    msg_intention: message.msg_intention,
                    status: r ? 200 : 405,
                    result: r,
                });
            } else {
                // Reject as this should not be possible
                send(rejection);
            }
            return;
        }

        if (message.msg_intention === 'READ') {
            if (message.hasOwnProperty('eventID')) {
                const m = message as QueryByEventMessage;
                const r = await database.getFilesForEvent(m.eventID);

                send({
                    ...acceptPartial,
                    msg_intention: message.msg_intention,
                    status: r ? 200 : 405,
                    result: r,
                });
            } else if (message.hasOwnProperty('fileID')) {
                const m = message as QueryByFileMessage;
                const r = await database.getEventsForFile(m.fileID);

                send({
                    ...acceptPartial,
                    msg_intention: message.msg_intention,
                    status: r ? 200 : 405,
                    result: r,
                });
            } else {
                // Reject as this should not be possible
                send(rejection);
            }
            return;
        }

        if (message.msg_intention === 'UPDATE') {
            if (message.hasOwnProperty('eventID')) {
                const m = message as SetFilesForEventMessage;
                const r = await database.setFilesForEvent(m.eventID, m.fileIDs);

                send({
                    ...acceptPartial,
                    msg_intention: message.msg_intention,
                    status: r ? 200 : 405,
                    result: r,
                });
            } else if (message.hasOwnProperty('fileID')) {
                const m = message as SetEventsForFileMessage;
                const r = await database.setEventsForFile(m.fileID, m.eventIDs);

                send({
                    ...acceptPartial,
                    msg_intention: message.msg_intention,
                    status: r ? 200 : 405,
                    result: r,
                });
            } else {
                // Reject as this should not be possible
                send(rejection);
            }
            return;
        }

        if (message.msg_intention === 'DELETE') {
            if (message.hasOwnProperty('eventID')) {
                const m = message as UnbindFilesFromEventMessage;
                const r = await database.removeFilesFromEvents(m.eventID, m.fileIDs);

                send({
                    ...acceptPartial,
                    msg_intention: message.msg_intention,
                    status: r ? 200 : 405,
                    result: r,
                });
            } else if (message.hasOwnProperty('fileID')) {
                const m = message as UnbindEventsFromFileMessage;
                const r = await database.removeEventsFromFile(m.fileID, m.eventIDs);

                send({
                    ...acceptPartial,
                    msg_intention: message.msg_intention,
                    status: r ? 200 : 405,
                    result: r,
                });
            } else {
                // Reject as this should not be possible
                send(rejection);
            }
            return;
        }
    } catch (e) {
        _b.error('failed to query database for events', {
            error: e as unknown,
        });

        // @ts-ignore - cries
        send({
            ...rejection,
            result: ['failed to execute update'],
        });
    }
}

async function execute(
    message: FileMessage.FileMessage,
    database: FileDatabase | undefined,
    send: (res: FileResponse.FileResponseMessage | FileResponse.FileServiceReadResponseMessage) => void,
) {
    if (!database) {
        _b.warn('query was received without a valid database connection');
        throw new Error('uninitialised database connection');
    }

    let status: number = constants.HTTP_STATUS_INTERNAL_SERVER_ERROR;
    let result: string[] | FileResponse.ShallowInternalFile[] = [];

    console.log('msg', message);

    try {
        switch (message.msg_intention) {
            case 'CREATE':
                result = await database.create(message);
                status = constants.HTTP_STATUS_OK;
                break;
            case 'DELETE':
                result = await database.delete(message);
                status = constants.HTTP_STATUS_OK;
                break;
            case 'READ':
                result = await database.query(message);
                status = constants.HTTP_STATUS_OK;
                break;
            case 'UPDATE':
                result = await database.update(message);
                status = constants.HTTP_STATUS_OK;
                break;
            default:
                status = constants.HTTP_STATUS_BAD_REQUEST;
        }
    } catch (e) {
        _b.error('failed to query database for events', {
            error: e as unknown,
        });

        if (e instanceof ClientFacingError) {
            send({
                userID: message.userID,
                status: MsgStatus.FAIL,
                msg_id: message.msg_id,
                msg_intention: message.msg_intention,
                result: [e.message],
            });
            return;
        } else {
            send({
                userID: message.userID,
                status: constants.HTTP_STATUS_INTERNAL_SERVER_ERROR,
                msg_id: message.msg_id,
                msg_intention: message.msg_intention,
                result: ['internal server error'],
            });
            return;
        }
    }

    if (message.msg_intention === 'CREATE' && status === 200) {
        console.log('out', result, status);
        // CREATE has to be handled differently because its two strings have v different meanings
        // as the second one is an upload URI instead of an ID
        send({
            msg_intention: message.msg_intention,
            msg_id: message.msg_id,
            result: [result[0]] as ShallowFileRepresentation[],
            status,
            uploadURI: result[1] as string,
            userID: message.userID,
        })
        return;
    }

    if (message.msg_intention === 'READ') {
        send({
            msg_intention: message.msg_intention,
            msg_id: message.msg_id,
            status,
            result: result as ShallowFileRepresentation[],
            userID: message.userID,
        });
    } else {
        send({
            msg_intention: message.msg_intention,
            msg_id: message.msg_id,
            status,
            result: result as string[],
            userID: message.userID,
        });
    }
}

export default function bind(database: FileDatabase, broker: RabbitNetworkHandler<any, any, any, any, any, any>): void {
    broker.on('any', (message, send, routingKey) => {
        _b.debug(`message ${message.msg_id} arrived on ${routingKey}`);
    });

    broker.on('query', (message, send, key) => {
        if (key.startsWith("file.details")) return execute(message, database, send)
        else if (key.startsWith("file.events")) return handleBinding(message, database, send);

        return Promise.reject(new Error('invalid routing key'));
    });
    _b.debug('bound [query] event');

    broker.on('delete', (message, send, key) => {
        if (key.startsWith("file.details")) return execute(message, database, send)
        else if (key.startsWith("file.events")) return handleBinding(message, database, send);

        return Promise.reject(new Error('invalid routing key'));
    });
    _b.debug('bound [delete] event');

    broker.on('update', (message, send, key) => {
        if (key.startsWith("file.details")) return execute(message, database, send)
        else if (key.startsWith("file.events")) return handleBinding(message, database, send);

        return Promise.reject(new Error('invalid routing key'));
    });
    _b.debug('bound [update] event');

    broker.on('create', (message, send, key) => {
        if (key.startsWith("file.details")) return execute(message, database, send)
        else if (key.startsWith("file.events")) return handleBinding(message, database, send);

        return Promise.reject(new Error('invalid routing key'));
    });
    _b.debug('bound [create] event');
}
