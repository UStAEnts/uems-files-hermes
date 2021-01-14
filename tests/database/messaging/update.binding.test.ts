import { Db, MongoClient, ObjectId } from "mongodb";
import { RabbitNetworkHandler } from "@uems/micro-builder";
import { BaseSchema } from "@uems/uemscommlib/build/BaseSchema";
import { FileBindingMessage, FileMessage, FileResponse, MsgStatus } from "@uems/uemscommlib";
import { BindingBroker } from "../../utilities/BindingBroker";
import { DatabaseFile, FileDatabase } from "../../../src/database/FileDatabase";
import { defaultAfterAll, defaultAfterEach, defaultBeforeAll, defaultBeforeEach, haveNoAdditionalKeys } from "../../utilities/setup";
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
import { constants } from "http2";
import SetEventsForFileMessage = FileBindingMessage.SetEventsForFileMessage;
import SetFilesForEventMessage = FileBindingMessage.SetFilesForEventMessage;

const empty = <T extends Intentions>(intention: T): { msg_intention: T, msg_id: 0, status: 0, userID: string } => ({
    msg_intention: intention,
    msg_id: 0,
    status: 0,
    userID: 'user',
})

describe('create messages of states', () => {
    let client!: MongoClient;
    let db!: Db;

    let broker!: BindingBroker<ReadFileMessage | QueryByFileMessage | QueryByEventMessage, DeleteFileMessage | UnbindFilesFromEventMessage | UnbindEventsFromFileMessage, UpdateFileMessage | SetEventsForFileMessage | SetFilesForEventMessage, CreateFileMessage | BindFilesToEventMessage | BindEventsToFileMessage, FileMessage.FileMessage>;
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

    it('should allow basic updates', async () => {
        const update = await broker.promiseEmit('update', {
            ...empty('UPDATE'),
            id: '56d9bf92f9be48771d6fe5b1',
            name: 'some new file name',
            type: 'new file type'
        }, 'file.details.update');

        expect(update).toHaveProperty('result');
        expect(update).toHaveProperty('status');
        expect(update.status).toEqual(MsgStatus.SUCCESS);
        expect(update.result).toHaveLength(1);
        expect(update.result[0]).toEqual('56d9bf92f9be48771d6fe5b1');

        const query = await broker.promiseEmit('query', {
            ...empty('READ'),
            id: '56d9bf92f9be48771d6fe5b1',
        }, 'file.details.read');

        expect(query).toHaveProperty('status', MsgStatus.SUCCESS);
        expect(query).toHaveProperty('result');
        expect(query.result).toHaveLength(1);
        expect(query.result[0]).toHaveProperty('name', 'some new file name');
        expect(query.result[0]).toHaveProperty('filename', 'alfredo_shark_beta');
        expect(query.result[0]).toHaveProperty('type', 'new file type');
    });

    it('should prevent adding additional properties via updates', async () => {
        // @ts-ignore
        const update = await broker.promiseEmit('update', {
            ...empty('UPDATE'),
            id: '56d9bf92f9be48771d6fe5b1',
            name: 'abc',
            newProperty: 'abc'
        }, 'file.details.update');

        expect(update).toHaveProperty('result');
        expect(update).toHaveProperty('status');
        expect(update.status).toEqual(MsgStatus.SUCCESS);
        expect(update.result).toHaveLength(1);
        expect(update.result[0]).toEqual('56d9bf92f9be48771d6fe5b1');

        const query = await broker.promiseEmit('query', {
            ...empty('READ'),
            id: '56d9bf92f9be48771d6fe5b1',
        }, 'file.details.read');

        expect(query).toHaveProperty('status', MsgStatus.SUCCESS);
        expect(query).toHaveProperty('result');
        expect(query.result).toHaveLength(1);
        haveNoAdditionalKeys(query.result[0], [
            'id',
            'name',
            'filename',
            'size',
            'mime',
            'owner',
            'type',
            'date',
            'downloadURL',
        ]);
    });

    it('should prevent updates with zero operations', async () => {
        const update = await broker.promiseEmit('update', {
            ...empty('UPDATE'),
            id: '56d9bf92f9be48771d6fe5b1',
        }, 'file.details.update');

        expect(update).toHaveProperty('result');
        expect(update).toHaveProperty('status');
        expect(update.status).not.toEqual(MsgStatus.SUCCESS);
        expect(update.status).not.toEqual(constants.HTTP_STATUS_INTERNAL_SERVER_ERROR);
        expect(update.result).toHaveLength(1);
        expect(update.result[0]).toContain('operation');
    });

    describe('bindings', () => {

        it('should allow overwriting events on a file via update', async () => {
            const update = await broker.promiseEmit('update', {
                ...empty('UPDATE'),
                fileID: '56d9bf92f9be48771d6fe5b1',
                eventIDs: ['ev1', 'ev2'],
            }, 'file.events.update');

            expect(update).toHaveProperty('result');
            expect(update).toHaveProperty('status');
            expect(update.status).toEqual(MsgStatus.SUCCESS);
            expect(update.result).toBeTruthy();

            const query = await broker.promiseEmit('query', {
                ...empty('READ'),
                fileID: '56d9bf92f9be48771d6fe5b1',
            }, 'file.events.read');

            console.log(query)

            expect(query).toHaveProperty('result');
            expect(query).toHaveProperty('status');
            expect(query.status).toEqual(MsgStatus.SUCCESS);
            expect(query.result).toHaveLength(2);
            expect(query.result[0]).toEqual('ev1');
            expect(query.result[1]).toEqual('ev2');
        });

        it('should allow overwriting files on an event via update', async () => {
            const update = await broker.promiseEmit('update', {
                ...empty('UPDATE'),
                fileIDs: ['56d9bf92f9be48771d6fe5b1'],
                eventID: 'alpha_event1',
            }, 'file.events.update');

            expect(update).toHaveProperty('result');
            expect(update).toHaveProperty('status');
            expect(update.status).toEqual(MsgStatus.SUCCESS);
            expect(update.result).toBeTruthy();

            const query = await broker.promiseEmit('query', {
                ...empty('READ'),
                fileID: '56d9bf92f9be48771d6fe5b1',
            }, 'file.events.read');

            console.log(query)

            expect(query).toHaveProperty('result');
            expect(query).toHaveProperty('status');
            expect(query.status).toEqual(MsgStatus.SUCCESS);
            expect(query.result).toHaveLength(3);
            expect(query.result).toContain('alpha_event1');
        });

    })

});
