import { Db, MongoClient, ObjectId } from "mongodb";
import { RabbitNetworkHandler } from "@uems/micro-builder";
import { BaseSchema, FileBindingMessage, FileMessage, FileResponse, MsgStatus } from "@uems/uemscommlib";
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
import ShallowInternalFile = FileResponse.ShallowInternalFile;

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
        it('should return all entries on an empty query', async () => {
            console.log(await db.collection('details').find({}).toArray());
            const query = await broker.promiseEmit('query', {
                ...empty('READ'),
            }, 'file.details.read');

            expect(query).toHaveProperty('status', MsgStatus.SUCCESS);
            expect(query).toHaveProperty('result');
            expect(query.result).toHaveLength(2);

            const ids = query.result.map((e: ShallowInternalFile) => e.id);
            expect(ids).toHaveLength(2);
            expect(ids).toContain('56d9bf92f9be48771d6fe5b0');
            expect(ids).toContain('56d9bf92f9be48771d6fe5b1');
        });

        it('should allow querying by ID', async () => {
            const query = await broker.promiseEmit('query', {
                ...empty('READ'),
                id: '56d9bf92f9be48771d6fe5b0',
            }, 'file.details.read');

            expect(query).toHaveProperty('status', MsgStatus.SUCCESS);
            expect(query).toHaveProperty('result');
            expect(query.result).toHaveLength(1);
            expect(query.result[0]).toHaveProperty('name', 'mongoose alex');
            expect(query.result[0]).toHaveProperty('filename', 'mongoose_alex_alpha');
        });

        it('should allow querying by substring of name', async () => {
            const query = await broker.promiseEmit('query', {
                ...empty('READ'),
                name: 'alex',
            }, 'file.details.read');

            expect(query).toHaveProperty('status', MsgStatus.SUCCESS);
            expect(query).toHaveProperty('result');
            expect(query.result).toHaveLength(1);
            expect(query.result[0]).toHaveProperty('id', '56d9bf92f9be48771d6fe5b0');
            expect(query.result[0]).toHaveProperty('name', 'mongoose alex');
            expect(query.result[0]).toHaveProperty('filename', 'mongoose_alex_alpha');
        });

        it('should only return valid properties', async () => {
            const query = await broker.promiseEmit('query', {
                ...empty('READ'),
            }, 'file.details.read');

            expect(query).toHaveProperty('status', MsgStatus.SUCCESS);
            expect(query).toHaveProperty('result');
            expect(query.result).toHaveLength(2);
            query.result.map((e: ShallowInternalFile) => expect(haveNoAdditionalKeys(e, [
                'id',
                'name',
                'filename',
                'size',
                'mime',
                'owner',
                'type',
                'date',
                'downloadURL',
            ])));
        });

        it('should return no entries on invalid query', async () => {
            const query = await broker.promiseEmit('query', {
                ...empty('READ'),
                name: 'invalid file'
            }, 'file.details.read');

            expect(query).toHaveProperty('status', MsgStatus.SUCCESS);
            expect(query).toHaveProperty('result');
            expect(query.result).toHaveLength(0);
        });
    });

    describe('file bindings', () => {
        it('should return all events by file ID', async () => {
            const query = await broker.promiseEmit('query', {
                ...empty('READ'),
                fileID: '56d9bf92f9be48771d6fe5b0',
            }, 'file.events.read');

            expect(query).toHaveProperty('status', MsgStatus.SUCCESS);
            expect(query).toHaveProperty('result');
            expect(query.result).toHaveLength(2);
            expect(query.result).toContain('alpha_event1')
            expect(query.result).toContain('alpha_event2')
        });

        it('should return all files by event ID', async () => {
            const query = await broker.promiseEmit('query', {
                ...empty('READ'),
                eventID: 'alpha_event1',
            }, 'file.events.read');

            expect(query).toHaveProperty('status', MsgStatus.SUCCESS);
            expect(query).toHaveProperty('result');
            expect(query.result).toHaveLength(1);
            expect(query.result).toContain('56d9bf92f9be48771d6fe5b0')
        });
    });
});
