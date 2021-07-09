import { Db, MongoClient } from "mongodb";
import { RabbitNetworkHandler } from "@uems/micro-builder/build/src";
import { BaseSchema, FileBindingMessage, FileMessage, FileResponse, MsgStatus } from "@uems/uemscommlib";
import { BindingBroker } from "../../utilities/BindingBroker";
import { DatabaseFile, FileDatabase } from "../../../src/database/FileDatabase";
import { defaultAfterAll, defaultAfterEach, defaultBeforeAll, defaultBeforeEach } from "../../utilities/setup";
import bind from "../../../src/Binding";
import { GetFileNameFunction, UpdateFunction } from "../../../src/uploader/UploadServer";
import { constants } from "http2";
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
        defaultBeforeEach([], client, db)
    });
    afterEach(() => defaultAfterEach(client, db));

    describe('file instances', () => {

        it('should allow creates to take place', async (done) => {
            broker.emit('create', {
                ...empty('CREATE'),
                name: 'name',
                userID: 'userid',
                type: 'type',
                size: 1000,
                filename: 'filename',
            }, 'file.details.create', (creation) => {
                expect(creation).toHaveProperty('result');
                expect(creation).toHaveProperty('status');

                expect(creation.status).toEqual(MsgStatus.SUCCESS);
                expect(creation.result).toHaveLength(1);

                broker.emit('query', { ...empty('READ'), id: creation.result[0] }, 'file.details.read', (data) => {
                    expect(data).toHaveProperty('result');
                    expect(data).toHaveProperty('status');

                    expect(data.status).toEqual(MsgStatus.SUCCESS);
                    expect(data.result).toHaveLength(1);
                    expect(data.result[0]).toHaveProperty('name', 'name');
                    expect(data.result[0]).toHaveProperty('size', 1000);
                    expect(data.result[0]).toHaveProperty('type', 'type');
                    expect(data.result[0]).toHaveProperty('filename', 'filename');

                    done();
                });
            });
        });

        it('should fail gracefully if the database is dead', async (done) => {
            let db: FileDatabase = new Proxy(fileDB, {
                get(target: FileDatabase, p: PropertyKey, receiver: any): any {
                    throw new Error('proxied database throwing error');
                },
            });

            broker.clear();
            bind(db, fakeBroker);

            broker.emit('create', {
                ...empty('CREATE'),
                name: 'name',
                userID: 'userid',
                type: 'type',
                size: 1000,
                filename: 'filename',
            }, 'file.details.create', (message) => {
                expect(message).toHaveProperty('result');
                expect(message).toHaveProperty('status');

                expect(message.result).toHaveLength(1);
                expect(message.status).not.toEqual(MsgStatus.SUCCESS);
                expect(message.result[0]).toEqual('internal server error');

                done();
            });
        });
    });

    describe('file bindings', () => {
        it('should allow binding files to events', async () => {
            mocks.provisionUploadURI.mockReturnValue('');
            // Need to create a file to bind to
            const result = await broker.promiseEmit('create', {
                ...empty('CREATE'),
                name: 'name',
                userID: 'userid',
                type: 'type',
                size: 1000,
                filename: 'filename',
            }, 'file.details.create')

            expect(result).toHaveProperty('result');
            expect(result).toHaveProperty('status');
            expect(result.status).toEqual(MsgStatus.SUCCESS);

            const bind = await broker.promiseEmit('create', {
                ...empty('CREATE'),
                eventID: 'event',
                fileIDs: [result.result[0]],
            }, 'file.events.create');

            expect(bind).toHaveProperty('result');
            expect(bind).toHaveProperty('status');
            expect(bind.status).toEqual(MsgStatus.SUCCESS);

            const query = await broker.promiseEmit('query', {
                ...empty('READ'),
                fileID: result.result[0],
            }, 'file.events.read');

            console.log(query)

            expect(query).toHaveProperty('result');
            expect(query).toHaveProperty('status');
            expect(query.status).toEqual(MsgStatus.SUCCESS);
            expect(query.result).toHaveLength(1);
            expect(query.result[0]).toEqual('event');
        });
        it('should allow binding events to files', async () => {
            mocks.provisionUploadURI.mockReturnValue('');
            // Need to create a file to bind to
            const result = await broker.promiseEmit('create', {
                ...empty('CREATE'),
                name: 'name',
                userID: 'userid',
                type: 'type',
                size: 1000,
                filename: 'filename',
            }, 'file.details.create')

            expect(result).toHaveProperty('result');
            expect(result).toHaveProperty('status');
            expect(result.status).toEqual(MsgStatus.SUCCESS);

            const bind = await broker.promiseEmit('create', {
                ...empty('CREATE'),
                eventIDs: ['event'],
                fileID: result.result[0],
            }, 'file.events.create');

            expect(bind).toHaveProperty('result');
            expect(bind).toHaveProperty('status');
            expect(bind.status).toEqual(MsgStatus.SUCCESS);

            const query = await broker.promiseEmit('query', {
                ...empty('READ'),
                fileID: result.result[0],
            }, 'file.events.read');

            console.log(query)

            expect(query).toHaveProperty('result');
            expect(query).toHaveProperty('status');
            expect(query.status).toEqual(MsgStatus.SUCCESS);
            expect(query.result).toHaveLength(1);
            expect(query.result[0]).toEqual('event');

        });

        it('reject on invalid file IDs', async () => {
            const bind = await broker.promiseEmit('create', {
                ...empty('CREATE'),
                eventIDs: ['event'],
                fileID: 'invalid file ID',
            }, 'file.events.create');

            expect(bind).toHaveProperty('result');
            expect(bind).toHaveProperty('status');
            expect(bind.status).not.toEqual(MsgStatus.SUCCESS);
            expect(bind.status).not.toEqual(constants.HTTP_STATUS_INTERNAL_SERVER_ERROR);
        });

        it('should not add a duplicate binding to a file', async () => {
            mocks.provisionUploadURI.mockReturnValue('');
            // Need to create a file to bind to
            const result = await broker.promiseEmit('create', {
                ...empty('CREATE'),
                name: 'name',
                userID: 'userid',
                type: 'type',
                size: 1000,
                filename: 'filename',
            }, 'file.details.create')

            expect(result).toHaveProperty('result');
            expect(result).toHaveProperty('status');
            expect(result.status).toEqual(MsgStatus.SUCCESS);

            let bind = await broker.promiseEmit('create', {
                ...empty('CREATE'),
                eventIDs: ['event'],
                fileID: result.result[0],
            }, 'file.events.create');

            expect(bind).toHaveProperty('result');
            expect(bind).toHaveProperty('status');
            expect(bind.status).toEqual(MsgStatus.SUCCESS);

            bind = await broker.promiseEmit('create', {
                ...empty('CREATE'),
                eventIDs: ['event'],
                fileID: result.result[0],
            }, 'file.events.create');

            expect(bind).toHaveProperty('result');
            expect(bind).toHaveProperty('status');
            expect(bind.status).toEqual(MsgStatus.SUCCESS);

            const query = await broker.promiseEmit('query', {
                ...empty('READ'),
                fileID: result.result[0],
            }, 'file.events.read');

            console.log(query)

            expect(query).toHaveProperty('result');
            expect(query).toHaveProperty('status');
            expect(query.status).toEqual(MsgStatus.SUCCESS);
            expect(query.result).toHaveLength(1);
            expect(query.result[0]).toEqual('event');
        });
    });

});
