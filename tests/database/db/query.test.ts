import { Db, MongoClient, ObjectId } from "mongodb";
import { BaseSchema } from "@uems/uemscommlib/build/BaseSchema";
import { DatabaseFile, FileDatabase } from "../../../src/database/FileDatabase";
import { GetFileNameFunction, UpdateFunction } from "../../../src/uploader/UploadServer";
import { FileResponse, MsgStatus } from "@uems/uemscommlib";
import Intentions = BaseSchema.Intentions;
import { defaultAfterAll, defaultAfterEach, defaultBeforeAll, defaultBeforeEach, haveNoAdditionalKeys } from "../../utilities/setup";

const empty = <T extends Intentions>(intention: T): { msg_intention: T, msg_id: 0, status: 0, userID: string } => ({
    msg_intention: intention,
    msg_id: 0,
    status: 0,
    userID: 'user',
})

describe('create messages of states', () => {
    let client!: MongoClient;
    let db!: Db;

    let mocks = {
        setResolver: jest.fn(),
        generateDownloadURI: jest.fn(),
        launch: jest.fn(),
        deleteFile: jest.fn(),
        provisionUploadURI: jest.fn(),
    }

    beforeAll(async () => {
        const { client: newClient, db: newDb } = await defaultBeforeAll();
        client = newClient;
        db = newDb;

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
    beforeEach(async () => {
        // Fully reset the mocks with new one
        mocks = {
            setResolver: jest.fn(),
            generateDownloadURI: jest.fn(),
            launch: jest.fn(),
            deleteFile: jest.fn(),
            provisionUploadURI: jest.fn(),
        }
        await defaultBeforeEach([{
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

    let fileDB: FileDatabase;

    describe('file instances', () => {
        it('should return all entries on an empty query', async () => {
            const query = await fileDB.query({
                ...empty('READ'),
            })
            const ids = query.map((e) => e.id);
            expect(ids).toHaveLength(2);
            expect(ids).toContain('56d9bf92f9be48771d6fe5b0');
            expect(ids).toContain('56d9bf92f9be48771d6fe5b1');
        });

        it('should allow querying by ID', async () => {
            const query = await fileDB.query({
                ...empty('READ'),
                id: '56d9bf92f9be48771d6fe5b0',
            });

            expect(query).toHaveLength(1);
            expect(query[0]).toHaveProperty('name', 'mongoose alex');
            expect(query[0]).toHaveProperty('filename', 'mongoose_alex_alpha');
        });

        it('should allow querying by substring of name', async () => {
            const query = await fileDB.query({
                ...empty('READ'),
                name: 'alex',
            });

            expect(query).toHaveLength(1);
            expect(query[0]).toHaveProperty('id', '56d9bf92f9be48771d6fe5b0');
            expect(query[0]).toHaveProperty('name', 'mongoose alex');
            expect(query[0]).toHaveProperty('filename', 'mongoose_alex_alpha');
        });

        it('should only return valid properties', async () => {
            const query = await fileDB.query({
                ...empty('READ'),
            });

            expect(query).toHaveLength(2);
            query.map((e) => expect(haveNoAdditionalKeys(e, [
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
            const query = await fileDB.query({
                ...empty('READ'),
                name: 'invalid file'
            });

            expect(query).toHaveLength(0);
        });
    });

    describe('file bindings', () => {
        it('should return all events by file ID', async () => {
            const query = await fileDB.getEventsForFile('56d9bf92f9be48771d6fe5b0');

            expect(query).toHaveLength(2);
            expect(query).toContain('alpha_event1')
            expect(query).toContain('alpha_event2')
        });

        it('should return all files by event ID', async () => {
            const query = await fileDB.getFilesForEvent('alpha_event1');

            expect(query).toHaveLength(1);
            expect(query).toContain('56d9bf92f9be48771d6fe5b0')
        });
    });
});
