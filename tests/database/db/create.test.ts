import { Db, MongoClient } from "mongodb";
import { BaseSchema } from "@uems/uemscommlib/build/BaseSchema";
import { DatabaseFile, FileDatabase } from "../../../src/database/FileDatabase";
import { GetFileNameFunction, UpdateFunction } from "../../../src/uploader/UploadServer";
import { FileResponse } from "@uems/uemscommlib";
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
        await defaultBeforeEach([], client, db)
    });
    afterEach(() => defaultAfterEach(client, db));

    let fileDB: FileDatabase;

    it('basic create inserts into the database', async () => {
        mocks.provisionUploadURI.mockReturnValue(Promise.resolve('faked download URI'));
        const result = await fileDB.create({
            ...empty('CREATE'),
            name: 'name',
            userid: 'userid',
            type: 'type',
            size: 1000,
            filename: 'filename',
        });

        expect(result).toHaveLength(2);
        expect(typeof (result[0]) === 'string').toBeTruthy();
        expect(result[1]).toEqual('faked download URI');

        const query = await fileDB.query({ ...empty('READ') });
        expect(query).toHaveLength(1);
        expect(query[0]).toHaveProperty('name', 'name');
        expect(query[0]).toHaveProperty('size', 1000);
        expect(query[0]).toHaveProperty('type', 'type');
        expect(query[0]).toHaveProperty('filename', 'filename');
        expect(haveNoAdditionalKeys(query[0], ['id', 'name', 'filename', 'size', 'mime', 'owner', 'type', 'date', 'downloadURL']));
    });

    it('should not include additional properties in creating records', async () => {
        mocks.provisionUploadURI.mockReturnValue('faked download URI');
        const result = await fileDB.create({
            ...empty('CREATE'),
            name: 'name',
            userid: 'userid',
            type: 'type',
            size: 1000,
            filename: 'filename',
            // @ts-ignore
            addProp: 'one',
            something: 'else',
        });

        expect(result).toHaveLength(2);
        expect(typeof (result[0]) === 'string').toBeTruthy();
        expect(result[1]).toEqual('faked download URI');

        const query = await fileDB.query({ ...empty('READ') });
        expect(query).toHaveLength(1);
        expect(query[0]).toHaveProperty('name', 'name');
        expect(query[0]).toHaveProperty('size', 1000);
        expect(query[0]).toHaveProperty('type', 'type');
        expect(query[0]).toHaveProperty('filename', 'filename');
        expect(haveNoAdditionalKeys(query[0], ['id', 'name', 'filename', 'size', 'mime', 'owner', 'type', 'date', 'downloadURL']));
    });

    describe('file bindings', () => {
        it('should allow binding files to events', async () => {
            mocks.provisionUploadURI.mockReturnValue('faked download URI');
            // Create a file
            const result = await fileDB.create({
                ...empty('CREATE'),
                name: 'name',
                userid: 'userid',
                type: 'type',
                size: 1000,
                filename: 'filename',
            });
            expect(result).toHaveLength(2);

            // Then try and bind stuff
            const bind = await fileDB.addEventsToFile(result[0], ['event id']);
            expect(bind).toBeTruthy();

            // Then we need to check that this binding now exists
            const data = await fileDB.getEventsForFile(result[0]);
            expect(data).toHaveLength(1);
            expect(data[0]).toEqual('event id');
        });

        it('reject on invalid file IDs', async () => {
            // Try and bind stuff
            await expect(fileDB.addEventsToFile('invalid ID', ['event id'])).rejects.toThrowError('invalid file ID');
        });

        it('should allow binding events to files', async () => {
            mocks.provisionUploadURI.mockReturnValue('faked download URI');
            // Create a file
            const result = await fileDB.create({
                ...empty('CREATE'),
                name: 'name',
                userid: 'userid',
                type: 'type',
                size: 1000,
                filename: 'filename',
            });
            expect(result).toHaveLength(2);

            // Then try and bind stuff
            const bind = await fileDB.addFilesToEvents('event id', [result[0]]);
            expect(bind).toBeTruthy();

            // Then we need to check that this binding now exists
            const data = await fileDB.getEventsForFile(result[0]);
            expect(data).toHaveLength(1);
            expect(data[0]).toEqual('event id');
        });

        it('should not add a duplicate binding to a file', async () => {
            mocks.provisionUploadURI.mockReturnValue('faked download URI');
            // Create a file
            const result = await fileDB.create({
                ...empty('CREATE'),
                name: 'name',
                userid: 'userid',
                type: 'type',
                size: 1000,
                filename: 'filename',
            });
            expect(result).toHaveLength(2);

            // Then try and bind stuff
            let bind = await fileDB.addFilesToEvents('event id', [result[0]]);
            expect(bind).toBeTruthy();

            // Then try and bind stuff
            bind = await fileDB.addEventsToFile(result[0], ['event id']);
            expect(bind).toBeTruthy();

            // Then we need to check that this binding now exists
            const data = await fileDB.getEventsForFile(result[0]);
            expect(data).toHaveLength(1);
            expect(data[0]).toEqual('event id');
        });
    });

});
