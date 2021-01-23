import { Db, MongoClient, ObjectId } from "mongodb";
import { BaseSchema, FileResponse } from "@uems/uemscommlib";
import { DatabaseFile, FileDatabase } from "../../../src/database/FileDatabase";
import { GetFileNameFunction, UpdateFunction } from "../../../src/uploader/UploadServer";
import { defaultAfterAll, defaultAfterEach, defaultBeforeAll, defaultBeforeEach } from "../../utilities/setup";
import Intentions = BaseSchema.Intentions;

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
        it('should allow normal deleting of file instances', async () => {
            const result = await fileDB.delete({
                ...empty('DELETE'),
                id: '56d9bf92f9be48771d6fe5b1',
            });

            expect(result).toEqual(['56d9bf92f9be48771d6fe5b1']);

            const query = await fileDB.query({ ...empty('READ') });
            expect(query).toHaveLength(1);
            expect(query[0]).toHaveProperty('id', '56d9bf92f9be48771d6fe5b0')
        });
        it('should reject invalid file IDs', async () => {
            await expect(fileDB.delete({
                ...empty('DELETE'),
                id: '56d9bf92f9be48771d6fe5b9',
            })).rejects.toThrowError('invalid entity ID')

            const query = await fileDB.query({ ...empty('READ') });
            expect(query).toHaveLength(2);

            const ids = query.map((e) => e.id);
            expect(ids).toHaveLength(2);
            expect(ids).toContain('56d9bf92f9be48771d6fe5b0');
            expect(ids).toContain('56d9bf92f9be48771d6fe5b1');
        });
    });

    describe('file bindings', () => {
        it('should allow deleting an existing file binding via the fileID', async () => {
            await expect(fileDB.removeEventsFromFile('56d9bf92f9be48771d6fe5b0', ['alpha_event1']))
                .resolves.toBeTruthy();

            await expect(fileDB.getEventsForFile('56d9bf92f9be48771d6fe5b0')).resolves.toEqual(['alpha_event2'])
        });
        it('should allow deleting an existing file binding via the eventID', async () => {
            await expect(fileDB.removeFilesFromEvents('alpha_event1', ['56d9bf92f9be48771d6fe5b0']))
                .resolves.toBeTruthy()

            console.log((await db.collection('details').find({}).toArray()))

            await expect(fileDB.getEventsForFile('56d9bf92f9be48771d6fe5b0')).resolves.toEqual(['alpha_event2'])
        });
        it('should ignore if a file binding does not exist already by fileID', async () => {
            await expect(fileDB.removeEventsFromFile('56d9bf92f9be48771d6fe5b0', ['invalid event id']))
                .resolves.toBeTruthy();

            const ids = await fileDB.getEventsForFile('56d9bf92f9be48771d6fe5b0');
            expect(ids).toHaveLength(2);
            expect(ids).toContain('alpha_event1');
            expect(ids).toContain('alpha_event2');
        });
        it('should ignore if a file binding does not exist already by eventID', async () => {
            await expect(fileDB.removeFilesFromEvents('invalid event id', ['56d9bf92f9be48771d6fe5b0']))
                .resolves.toBeTruthy();

            const ids = await fileDB.getEventsForFile('56d9bf92f9be48771d6fe5b0');
            expect(ids).toHaveLength(2);
            expect(ids).toContain('alpha_event1');
            expect(ids).toContain('alpha_event2');
        });
    });
});
