import { constants } from "http2";
import { Db, MongoClient, ObjectId } from "mongodb";
import { RabbitNetworkHandler } from "@uems/micro-builder/build/src";
import { BaseSchema, FileBindingMessage, FileMessage, FileResponse, MsgStatus } from "@uems/uemscommlib";
import { BindingBroker } from "../../utilities/BindingBroker";
import { DatabaseFile, FileDatabase } from "../../../src/database/FileDatabase";
import { defaultAfterAll, defaultAfterEach, defaultBeforeAll, defaultBeforeEach } from "../../utilities/setup";
import bind from "../../../src/Binding";
import { GetFileNameFunction, UpdateFunction } from "../../../src/uploader/UploadServer";
import Intentions = BaseSchema.Intentions;
import ReadFileMessage = FileMessage.ReadFileMessage;
import DeleteFileMessage = FileMessage.DeleteFileMessage;
import UpdateFileMessage = FileMessage.UpdateFileMessage;
import CreateFileMessage = FileMessage.CreateFileMessage;
import UnbindFilesFromEventMessage = FileBindingMessage.UnbindFilesFromEventMessage;
import UnbindEventsFromFileMessage = FileBindingMessage.UnbindEventsFromFileMessage;
import BindFilesToEventMessage = FileBindingMessage.BindFilesToEventMessage;
import BindEventsToFileMessage = FileBindingMessage.BindEventsToFileMessage;
import QueryByFileMessage = FileBindingMessage.QueryByFileMessage;
import QueryByEventMessage = FileBindingMessage.QueryByEventMessage;


const empty = <T extends Intentions>(intention: T): { msg_intention: T, msg_id: 0, status: 0, userID: string } => ({
    msg_intention: intention,
    msg_id: 0,
    status: 0,
    userID: 'user',
})

describe('create messages of states', () => {
    let client!: MongoClient;
    let db!: Db;

    let broker!: BindingBroker<ReadFileMessage | QueryByFileMessage | QueryByEventMessage, DeleteFileMessage | UnbindFilesFromEventMessage | UnbindEventsFromFileMessage, UpdateFileMessage, CreateFileMessage | BindFilesToEventMessage | BindEventsToFileMessage, FileMessage.FileMessage>;
    let fakeBroker!: RabbitNetworkHandler<any, any, any, any, any, any>;

    let mocks = {
        setResolver: jest.fn(),
        generateDownloadURI: jest.fn(),
        launch: jest.fn(),
        deleteFile: jest.fn(),
        provisionUploadURI: jest.fn(),
    }

    let fileDB: FileDatabase;

    beforeAll(async () => {
        const { client: newClient, db: newDb } = await defaultBeforeAll();
        client = newClient;
        db = newDb;

        broker = new BindingBroker();
        fakeBroker = broker as unknown as RabbitNetworkHandler<any, any, any, any, any, any>;

        fileDB = new FileDatabase(db, { details: 'details', changelog: 'changelog' }, {
            setResolver(resolver: GetFileNameFunction): void {
                mocks.setResolver.apply(this, resolver);
            },
            generateDownloadURI(file: DatabaseFile): Promise<string> {
                return Promise.resolve(mocks.generateDownloadURI.apply(this, file));
            },
            launch(): Promise<void> {
                mocks.launch.apply(this);
                return Promise.resolve();
            },
            deleteFile(file: DatabaseFile): Promise<void> {
                mocks.deleteFile.apply(this, file);
                return Promise.resolve();
            },
            provisionUploadURI(file: FileResponse.InternalFile, update: UpdateFunction): Promise<string> {
                return Promise.resolve(mocks.provisionUploadURI.apply(this, [file, update]));
            },
            stop(): Promise<void> {
                return Promise.resolve();
            }
        });
    });
    afterAll(() => defaultAfterAll(client, db));
    beforeEach(() => {
        // Fully reset the mocks with new one
        mocks = {
            setResolver: jest.fn(),
            generateDownloadURI: jest.fn(),
            launch: jest.fn(),
            deleteFile: jest.fn(),
            provisionUploadURI: jest.fn(),
        }

        broker.clear();
        bind(fileDB, fakeBroker);
        defaultBeforeEach([{
            _id: new ObjectId('56d9bf92f9be48771d6fe5b0'),
            name: 'mongoose alex',
            filename: 'mongoose_alex_alpha',
            size: 1000,
            mime: 'text/html',
            owner: 'alpha_owner',
            type: 'alpha doc',
            date: 10345,
            downloadURL: '/somewhere',
            filePath: 'fs/data.com',
            events: ['alpha_event1', 'alpha_event2'],
        }, {
            _id: new ObjectId('56d9bf92f9be48771d6fe5b1'),
            name: 'alfredo shark',
            filename: 'alfredo_shark_beta',
            size: 1500,
            mime: 'text/json',
            owner: 'beta_owner',
            type: 'beta doc',
            date: 10349,
            downloadURL: '/beta',
            filePath: 'fs/beta.com',
            events: ['beta_event1', 'beta_event2'],
        }], client, db)
    });
    afterEach(() => defaultAfterEach(client, db));

    describe('file instances', () => {
        it('should allow normal deleting of file instances', async () => {
            const result = await broker.promiseEmit('delete', {
                ...empty('DELETE'),
                id: '56d9bf92f9be48771d6fe5b1'
            }, 'file.details.delete');

            expect(result).toHaveProperty('status', MsgStatus.SUCCESS);
            expect(result).toHaveProperty('result');
            expect(result.result).toHaveLength(1);
            expect(result.result[0]).toEqual('56d9bf92f9be48771d6fe5b1');

            const query = await broker.promiseEmit('query', {
                ...empty('READ'),
            }, 'file.details.read');

            expect(query).toHaveProperty('status', MsgStatus.SUCCESS);
            expect(query).toHaveProperty('result');
            expect(query.result).toHaveLength(1);
            expect(query.result[0]).toHaveProperty('id', '56d9bf92f9be48771d6fe5b0');
        });

        it('should reject invalid file IDs', async () => {
            const result = await broker.promiseEmit('delete', {
                ...empty('DELETE'),
                id: '56d9bf92f9be48771d6fe5b9'
            }, 'file.details.delete');

            expect(result).toHaveProperty('status');
            expect(result.status).not.toEqual(MsgStatus.SUCCESS);
            expect(result.status).not.toEqual(constants.HTTP_STATUS_INTERNAL_SERVER_ERROR);

            expect(result).toHaveProperty('result');
            expect(result.result).toHaveLength(1);
            expect(result.result[0]).toContain('entity');
        });

        it('should fail gracefully when the database fails', async () => {
            let db: FileDatabase = new Proxy(fileDB, {
                get(target: FileDatabase, p: PropertyKey, receiver: any): any {
                    throw new Error('proxied database throwing error');
                },
            });

            broker.clear();
            bind(db, fakeBroker);

            const result = await broker.promiseEmit('delete', {
                ...empty('DELETE'),
                id: '56d9bf92f9be48771d6fe5b1'
            }, 'file.details.delete');

            expect(result).toHaveProperty('status');
            expect(result.status).not.toEqual(MsgStatus.SUCCESS);

            expect(result).toHaveProperty('result');
            expect(result.result).toHaveLength(1);
            expect(result.result[0]).toContain('server error');
        })
    });

    describe('file bindings', () => {
        it('should allow deleting an existing file binding via the fileID', async () => {
            const result = await broker.promiseEmit('delete', {
                ...empty('DELETE'),
                fileID: '56d9bf92f9be48771d6fe5b0',
                eventIDs: ['alpha_event1'],
            }, 'file.events.read');

            expect(result).toHaveProperty('status');
            expect(result.status).toEqual(MsgStatus.SUCCESS);
            expect(result).toHaveProperty('result');
            expect(result.result).toBeTruthy();

            const query = await broker.promiseEmit('query', {
                ...empty('READ'),
                fileID: '56d9bf92f9be48771d6fe5b0'
            }, 'file.events.read');

            expect(query).toHaveProperty('status');
            expect(query.status).toEqual(MsgStatus.SUCCESS);
            expect(query).toHaveProperty('result');
            expect(query.result).toHaveLength(1);
            expect(query.result[0]).toEqual('alpha_event2');
        });
        it('should allow deleting an existing file binding via the eventID', async () => {
            const result = await broker.promiseEmit('delete', {
                ...empty('DELETE'),
                fileID: '56d9bf92f9be48771d6fe5b0',
                eventIDs: ['alpha_event1'],
            }, 'file.events.read');

            expect(result).toHaveProperty('status');
            expect(result.status).toEqual(MsgStatus.SUCCESS);
            expect(result).toHaveProperty('result');
            expect(result.result).toBeTruthy();

            const query = await broker.promiseEmit('query', {
                ...empty('READ'),
                fileID: '56d9bf92f9be48771d6fe5b0'
            }, 'file.events.read');

            expect(query).toHaveProperty('status');
            expect(query.status).toEqual(MsgStatus.SUCCESS);
            expect(query).toHaveProperty('result');
            expect(query.result).toHaveLength(1);
            expect(query.result[0]).toEqual('alpha_event2');
        });
        it('should ignore if a file binding does not already exist by fileID', async () => {
            const result = await broker.promiseEmit('delete', {
                ...empty('DELETE'),
                fileID: '56d9bf92f9be48771d6fe5b0',
                eventIDs: ['event id that doesnt exist'],
            }, 'file.events.read');

            expect(result).toHaveProperty('status');
            expect(result.status).toEqual(MsgStatus.SUCCESS);
            expect(result).toHaveProperty('result');
            expect(result.result).toBeTruthy();

            const query = await broker.promiseEmit('query', {
                ...empty('READ'),
                fileID: '56d9bf92f9be48771d6fe5b0'
            }, 'file.events.read');

            expect(query).toHaveProperty('status');
            expect(query.status).toEqual(MsgStatus.SUCCESS);
            expect(query).toHaveProperty('result');
            expect(query.result).toHaveLength(2);
            expect(query.result).toContain('alpha_event1');
            expect(query.result).toContain('alpha_event2');
        });
        it('should ignore if a file binding does not already exist by eventID', async () => {
            const result = await broker.promiseEmit('delete', {
                ...empty('DELETE'),
                fileIDs: ['56d9bf92f9be48771d6fe5b0'],
                eventID: 'event id that doesnt exist',
            }, 'file.events.read');

            expect(result).toHaveProperty('status');
            expect(result.status).toEqual(MsgStatus.SUCCESS);
            expect(result).toHaveProperty('result');
            expect(result.result).toBeTruthy();

            const query = await broker.promiseEmit('query', {
                ...empty('READ'),
                fileID: '56d9bf92f9be48771d6fe5b0'
            }, 'file.events.read');

            expect(query).toHaveProperty('status');
            expect(query.status).toEqual(MsgStatus.SUCCESS);
            expect(query).toHaveProperty('result');
            expect(query.result).toHaveLength(2);
            expect(query.result).toContain('alpha_event1');
            expect(query.result).toContain('alpha_event2');
        });
    });
});
