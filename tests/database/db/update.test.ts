import { Db, MongoClient, ObjectId } from "mongodb";
import { BaseSchema, FileResponse } from "@uems/uemscommlib";
import { DatabaseFile, FileDatabase } from "../../../src/database/FileDatabase";
import { GetFileNameFunction, UpdateFunction } from "../../../src/uploader/UploadServer";
import { defaultAfterAll, defaultAfterEach, defaultBeforeAll, defaultBeforeEach, haveNoAdditionalKeys } from "../../utilities/setup";
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

    it('should allow basic updates', async () => {
        const update = await fileDB.update({
            ...empty('UPDATE'),
            id: '56d9bf92f9be48771d6fe5b1',
            name: 'some new file name',
            type: 'new file type'
        });

        expect(update).toEqual(['56d9bf92f9be48771d6fe5b1']);

        const query = await fileDB.query({
            ...empty('READ'),
            id: '56d9bf92f9be48771d6fe5b1',
        });

        expect(query).toHaveLength(1);
        expect(query[0]).toHaveProperty('name', 'some new file name');
        expect(query[0]).toHaveProperty('filename', 'alfredo_shark_beta');
        expect(query[0]).toHaveProperty('type', 'new file type');
    });

    it('should prevent adding additional properties via updates', async () => {
        const update = await fileDB.update({
            ...empty('UPDATE'),
            id: '56d9bf92f9be48771d6fe5b1',
            name: 'some new file name',
            type: 'new file type',
            // @ts-ignore
            newProp: 'new property',
        });

        expect(update).toEqual(['56d9bf92f9be48771d6fe5b1']);

        const query = await fileDB.query({
            ...empty('READ'),
            id: '56d9bf92f9be48771d6fe5b1',
        });
        expect(query).toHaveLength(1);
        haveNoAdditionalKeys(query[0], [
            'id',
            'name',
            'filename',
            'size',
            'mime',
            'owner',
            'type',
            'date',
            'downloadURL',
            'checksum'
        ]);
    });

    describe('bindings', () => {

        it('should allow overwriting events on a file via update', async () => {
            const update = await fileDB.setEventsForFile('56d9bf92f9be48771d6fe5b1', ['ev1', 'ev2']);
            expect(update).toBeTruthy();

            const query = await fileDB.getEventsForFile('56d9bf92f9be48771d6fe5b1');
            expect(query).toHaveLength(2);
            expect(query).toContain('ev1');
            expect(query).toContain('ev2');
        });

        it('should allow overwriting files on an event via update', async () => {
            const update = await fileDB.setFilesForEvent('alpha_event1', ['56d9bf92f9be48771d6fe5b1']);
            expect(update).toBeTruthy();

            const query = await fileDB.getEventsForFile('56d9bf92f9be48771d6fe5b1');
            expect(query).toHaveLength(3);
            expect(query).toContain('alpha_event1');
        })

    })
});
