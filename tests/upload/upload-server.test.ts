import { GetFileNameFunction, LocalUploadServer } from "../../src/uploader/UploadServer";
import axios from "axios";
import tmp, { DirResult } from "tmp";
import * as crypto from "crypto";
import path from "path";
import fs from "fs/promises";
import * as fsn from 'fs';
import FormData from 'form-data';
import * as util from "util";
import { FileResponse } from "@uems/uemscommlib";
import InternalFile = FileResponse.InternalFile;

const TEST_PORT = 15754;
const exists = (path: string) => fs.stat(path).then(() => true).catch(() => {
    throw false;
});

describe('upload server tests', () => {
    let uploadServer: LocalUploadServer;
    let mockResolver: jest.Mock;
    let uploadPath: string;

    beforeEach(() => {
        uploadPath = path.join('/tmp', crypto.randomBytes(5).toString('base64').replace('/', '_'));

        uploadServer = new LocalUploadServer({
            port: TEST_PORT,
            domain: `http://localhost:${TEST_PORT}`,
            uploadPath: uploadPath,
        });

        mockResolver = jest.fn();
        uploadServer.setResolver(mockResolver)
    });

    afterEach(async () => {
        await uploadServer.stop();
        await fs.rm(uploadPath, {
            recursive: true,
        });
    });

    it('should launch a server on the expected port', async () => {
        await uploadServer.launch();
        await expect(axios('http://localhost:' + TEST_PORT, { method: 'get' }))
            .rejects.toHaveProperty(['response', 'status'], 404);
    });

    it('should create the upload folder on construct', async () => {
        await expect(exists(uploadPath)).rejects;
        await uploadServer.launch();
        await expect(exists(uploadPath)).resolves.toBeTruthy();
    })

    it('should delete files on the file system when requested', async () => {
        const file = tmp.fileSync({
            dir: uploadPath,
            discardDescriptor: true,
        });
        await expect(exists(file.name)).resolves.toBeTruthy();

        // @ts-ignore - TODO: this test is likely to fail on implementation change
        await uploadServer.deleteFile({
            filePath: '/download/' + path.basename(file.name),
        });

        await expect(exists(file.name)).rejects.toBeFalsy();
    })

    it('should reject when trying to delete an invalid key', async () => {
        try {
            // @ts-ignore
            await uploadServer.deleteFile({
                filePath: '/download/invalid file key',
            })
            expect(false).toBeTruthy();
        } catch (e) {
            expect(e.message).toContain('ENOENT');
        }
    })

    it('allow applying a mime whitelist', async () => {
        uploadServer = new LocalUploadServer({
            port: TEST_PORT,
            domain: `http://localhost:${TEST_PORT}`,
            uploadPath: uploadPath,
            mimeList: ['text/html'],
            mimeType: 'WHITELIST',
        });

        await uploadServer.launch();

        // Test that a file matching the whitelist is approved
        await (async () => {
            let provisionResolve: Function;
            let provisionPromise = new Promise(resolve => {
                provisionResolve = resolve;
            });

            const url = await uploadServer.provisionUploadURI({
                downloadURL: '',
                // @ts-ignore
                owner: 'owner',
                mime: '',
                date: Date.now(),
                name: 'some random file',
                size: 54,
                type: 'something',
                filename: 'some file name',
                id: '00000',
            }, (filePath, fileName, mime) => {
                console.warn('Update')
                expect(filePath).toEqual(`/download/${url.replace(`http://localhost:${TEST_PORT}/upload/`, '')}`);
                expect(fileName).toEqual('something.html');
                expect(mime).toEqual('text/html');

                provisionResolve();
                return Promise.resolve();
            });

            const file = tmp.fileSync({
                dir: uploadPath,
                name: 'something.html',
            });
            fsn.writeSync(file.fd, '<!DOCTYPE html><html><head></head><body></body></html>', null, 'utf8');

            const form = new FormData();
            form.append("data", fsn.createReadStream(file.name), { knownLength: fsn.statSync(file.name).size });

            const headers = {
                ...form.getHeaders(),
                "Content-Length": form.getLengthSync()
            };

            await expect(axios.post(`${url}`, form, { headers })).resolves.toHaveProperty(['data', 'status'], 'OK');
            await provisionPromise;
        })();

        // Test that a file not on the whitelist is rejected
        await (async () => {
            const mock = jest.fn().mockReturnValue(Promise.resolve());
            const url = await uploadServer.provisionUploadURI({
                downloadURL: '',
                // @ts-ignore
                owner: 'owner',
                mime: '',
                date: Date.now(),
                name: 'some random file',
                size: 344,
                type: 'something',
                filename: 'some file name',
                id: '00000',
            }, mock);

            const file = tmp.fileSync({
                dir: uploadPath,
                name: 'data.png',
            });
            fsn.writeSync(file.fd, 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAx0lEQVQ4T2PsD7P+z4AGvmr4MHDf2IIuDOdff/wNzmYEGXCKQZzBjOElA0hCU5YLQyNMHl0CpB5sALoEsgZchsL0YDUAJonsVGwuA3mVMc3S8D82SWRXIbsC3TsoLsDlV2yhCXMdY0td+3/kECfkZ3TvobgA3c/YohPZAngsIGsE2YAvTNBdiNUFhAIVZAnMdSgJCVdg4TOQqHQAMwBmK3JsETSAkHcwEhJyviAmQMEGyLmG4c192BIYKDY+yypCkjIhm/ClRADJY4Yb/ZsNEAAAAABJRU5ErkJgggAA', null, 'utf8');

            const form = new FormData();
            form.append("data", fsn.createReadStream(file.name), { knownLength: fsn.statSync(file.name).size });

            const headers = {
                ...form.getHeaders(),
                "Content-Length": form.getLengthSync()
            };

            await expect(axios.post(`${url}`, form, { headers })).resolves.toHaveProperty(['data', 'status'], 'FAIL');
            expect(mock).not.toHaveBeenCalled();
        })();
    })

    it('allow applying a mime blacklist', async () => {
        uploadServer = new LocalUploadServer({
            port: TEST_PORT,
            domain: `http://localhost:${TEST_PORT}`,
            uploadPath: uploadPath,
            mimeList: ['image/png'],
            mimeType: 'BLACKLIST',
        });

        let provisionResolve: Function;
        let provisionPromise = new Promise(resolve => {
            provisionResolve = resolve;
        });

        await uploadServer.launch();

        // Test that a file matching the whitelist is approved
        await (async () => {
            const url = await uploadServer.provisionUploadURI({
                downloadURL: '',
                // @ts-ignore
                owner: 'owner',
                mime: '',
                date: Date.now(),
                name: 'some random file',
                size: 54,
                type: 'something',
                filename: 'some file name',
                id: '00000',
            }, (filePath, fileName, mime) => {
                console.warn('Update')
                expect(filePath).toEqual(`/download/${url.replace(`http://localhost:${TEST_PORT}/upload/`, '')}`);
                expect(fileName).toEqual('something.html');
                expect(mime).toEqual('text/html');

                provisionResolve();
                return Promise.resolve();
            });

            const file = tmp.fileSync({
                dir: uploadPath,
                name: 'something.html',
            });
            fsn.writeSync(file.fd, '<!DOCTYPE html><html><head></head><body></body></html>', null, 'utf8');

            const form = new FormData();
            form.append("data", fsn.createReadStream(file.name), { knownLength: fsn.statSync(file.name).size });

            const headers = {
                ...form.getHeaders(),
                "Content-Length": form.getLengthSync()
            };

            await expect(axios.post(`${url}`, form, { headers })).resolves.toHaveProperty(['data', 'status'], 'OK');
            await provisionPromise;
        })();

        // Test that a file not on the whitelist is rejected
        await (async () => {
            const mock = jest.fn().mockReturnValue(Promise.resolve());
            const url = await uploadServer.provisionUploadURI({
                downloadURL: '',
                // @ts-ignore
                owner: 'owner',
                mime: '',
                date: Date.now(),
                name: 'some random file',
                size: 344,
                type: 'something',
                filename: 'some file name',
                id: '00000',
            }, mock);

            const file = tmp.fileSync({
                dir: uploadPath,
                name: 'data.png',
            });
            fsn.writeSync(file.fd, 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAx0lEQVQ4T2PsD7P+z4AGvmr4MHDf2IIuDOdff/wNzmYEGXCKQZzBjOElA0hCU5YLQyNMHl0CpB5sALoEsgZchsL0YDUAJonsVGwuA3mVMc3S8D82SWRXIbsC3TsoLsDlV2yhCXMdY0td+3/kECfkZ3TvobgA3c/YohPZAngsIGsE2YAvTNBdiNUFhAIVZAnMdSgJCVdg4TOQqHQAMwBmK3JsETSAkHcwEhJyviAmQMEGyLmG4c192BIYKDY+yypCkjIhm/ClRADJY4Yb/ZsNEAAAAABJRU5ErkJgggAA', null, 'utf8');

            const form = new FormData();
            form.append("data", fsn.createReadStream(file.name), { knownLength: fsn.statSync(file.name).size });

            const headers = {
                ...form.getHeaders(),
                "Content-Length": form.getLengthSync()
            };

            await expect(axios.post(`${url}`, form, { headers })).resolves.toHaveProperty(['data', 'status'], 'FAIL');
            expect(mock).not.toHaveBeenCalled();
        })();
    })

    it('allow applying a max size limit', async () => {
        uploadServer = new LocalUploadServer({
            port: TEST_PORT,
            domain: `http://localhost:${TEST_PORT}`,
            uploadPath: uploadPath,
            maxSize: 30,
        });
        await uploadServer.launch();

        const mock = jest.fn().mockReturnValue(Promise.resolve());
        const url = await uploadServer.provisionUploadURI({
            downloadURL: '',
            // @ts-ignore
            owner: 'owner',
            mime: '',
            date: Date.now(),
            name: 'some random file',
            size: 344,
            type: 'something',
            filename: 'some file name',
            id: '00000',
        }, mock);

        const file = tmp.fileSync({
            dir: uploadPath,
            name: 'data.png',
        });
        fsn.writeSync(file.fd, 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAx0lEQVQ4T2PsD7P+z4AGvmr4MHDf2IIuDOdff/wNzmYEGXCKQZzBjOElA0hCU5YLQyNMHl0CpB5sALoEsgZchsL0YDUAJonsVGwuA3mVMc3S8D82SWRXIbsC3TsoLsDlV2yhCXMdY0td+3/kECfkZ3TvobgA3c/YohPZAngsIGsE2YAvTNBdiNUFhAIVZAnMdSgJCVdg4TOQqHQAMwBmK3JsETSAkHcwEhJyviAmQMEGyLmG4c192BIYKDY+yypCkjIhm/ClRADJY4Yb/ZsNEAAAAABJRU5ErkJgggAA', null, 'utf8');

        const form = new FormData();
        form.append("data", fsn.createReadStream(file.name), { knownLength: fsn.statSync(file.name).size });

        const headers = {
            ...form.getHeaders(),
            "Content-Length": form.getLengthSync()
        };

        await expect(axios.post(`${url}`, form, { headers })).resolves.toHaveProperty(['data', 'status'], 'FAIL');
        expect(mock).not.toHaveBeenCalled();
    })

    it('should only allow uploads for provisioned keys', async () => {
        await uploadServer.launch();
        await expect(axios.post(`http://localhost:${TEST_PORT}/upload/ABCDEFHGJIGHSDAHDSAD`)).rejects.toHaveProperty(['response', 'status'], 404);
    })

    it('should only allow downloads for existing files', async () => {
        await uploadServer.launch();
        await expect(axios.post(`http://localhost:${TEST_PORT}/download/ABCDEFHGJIGHSDAHDSAD`)).rejects.toHaveProperty(['response', 'status'], 404);
    })

    it('should reject file requests with the wrong file key', async () => {
        await uploadServer.launch();

        const mock = jest.fn().mockReturnValue(Promise.resolve());
        const url = await uploadServer.provisionUploadURI({
            downloadURL: '',
            // @ts-ignore
            owner: 'owner',
            mime: '',
            date: Date.now(),
            name: 'some random file',
            size: 344,
            type: 'something',
            filename: 'some file name',
            id: '00000',
        }, mock);

        const file = tmp.fileSync({
            dir: uploadPath,
            name: 'data.png',
        });
        fsn.writeSync(file.fd, 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAx0lEQVQ4T2PsD7P+z4AGvmr4MHDf2IIuDOdff/wNzmYEGXCKQZzBjOElA0hCU5YLQyNMHl0CpB5sALoEsgZchsL0YDUAJonsVGwuA3mVMc3S8D82SWRXIbsC3TsoLsDlV2yhCXMdY0td+3/kECfkZ3TvobgA3c/YohPZAngsIGsE2YAvTNBdiNUFhAIVZAnMdSgJCVdg4TOQqHQAMwBmK3JsETSAkHcwEhJyviAmQMEGyLmG4c192BIYKDY+yypCkjIhm/ClRADJY4Yb/ZsNEAAAAABJRU5ErkJgggAA', null, 'utf8');

        const form = new FormData();
        form.append("wrong-key", fsn.createReadStream(file.name), { knownLength: fsn.statSync(file.name).size });

        const headers = {
            ...form.getHeaders(),
            "Content-Length": form.getLengthSync()
        };

        const request = await axios.post(`${url}`, form, { headers });
        expect(request).toHaveProperty(['data', 'status'], 'FAIL');
        expect(request).toHaveProperty(['data', 'error']);
        expect(request.data.error).toContain('data');
        expect(mock).not.toHaveBeenCalled();
    })

    it('should reject upload requests with no files', async () => {
        await uploadServer.launch();

        const mock = jest.fn().mockReturnValue(Promise.resolve());
        const url = await uploadServer.provisionUploadURI({
            downloadURL: '',
            // @ts-ignore
            owner: 'owner',
            mime: '',
            date: Date.now(),
            name: 'some random file',
            size: 344,
            type: 'something',
            filename: 'some file name',
            id: '00000',
        }, mock);

        const request = await axios.post(`${url}`);
        expect(request).toHaveProperty(['data', 'status'], 'FAIL');
        expect(request).toHaveProperty(['data', 'error']);
        expect(request.data.error).toContain('a file');

        expect(mock).not.toHaveBeenCalled();
    })

    it('should reject upload requests with too many files', async () => {
        await uploadServer.launch();

        const mock = jest.fn().mockReturnValue(Promise.resolve());
        const url = await uploadServer.provisionUploadURI({
            downloadURL: '',
            // @ts-ignore
            owner: 'owner',
            mime: '',
            date: Date.now(),
            name: 'some random file',
            size: 344,
            type: 'something',
            filename: 'some file name',
            id: '00000',
        }, mock);

        const file = tmp.fileSync({
            dir: uploadPath,
            name: 'data.png',
        });
        fsn.writeSync(file.fd, 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAx0lEQVQ4T2PsD7P+z4AGvmr4MHDf2IIuDOdff/wNzmYEGXCKQZzBjOElA0hCU5YLQyNMHl0CpB5sALoEsgZchsL0YDUAJonsVGwuA3mVMc3S8D82SWRXIbsC3TsoLsDlV2yhCXMdY0td+3/kECfkZ3TvobgA3c/YohPZAngsIGsE2YAvTNBdiNUFhAIVZAnMdSgJCVdg4TOQqHQAMwBmK3JsETSAkHcwEhJyviAmQMEGyLmG4c192BIYKDY+yypCkjIhm/ClRADJY4Yb/ZsNEAAAAABJRU5ErkJgggAA', null, 'utf8');

        const form = new FormData();
        form.append("wrong-key", fsn.createReadStream(file.name), { knownLength: fsn.statSync(file.name).size });
        form.append("wrong-two", fsn.createReadStream(file.name), { knownLength: fsn.statSync(file.name).size });

        const headers = {
            ...form.getHeaders(),
            "Content-Length": form.getLengthSync()
        };

        const request = await axios.post(`${url}`, form, { headers });
        expect(request).toHaveProperty(['data', 'status'], 'FAIL');
        expect(request).toHaveProperty(['data', 'error']);
        expect(request.data.error).toContain('one file');

        expect(mock).not.toHaveBeenCalled();
    })

    it('should reject if not ID is provided', async () => {

    });

    it('should support downloading uploaded files', async () => {
        const file: InternalFile = {
            downloadURL: '',
            // @ts-ignore
            owner: 'owner',
            mime: '',
            date: Date.now(),
            name: 'some random file',
            size: 344,
            type: 'something',
            filename: 'some file name',
            id: '00000',
        };

        const fileData = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAx0lEQVQ4T2PsD7P+z4AGvmr4MHDf2IIuDOdff/wNzmYEGXCKQZzBjOElA0hCU5YLQyNMHl0CpB5sALoEsgZchsL0YDUAJonsVGwuA3mVMc3S8D82SWRXIbsC3TsoLsDlV2yhCXMdY0td+3/kECfkZ3TvobgA3c/YohPZAngsIGsE2YAvTNBdiNUFhAIVZAnMdSgJCVdg4TOQqHQAMwBmK3JsETSAkHcwEhJyviAmQMEGyLmG4c192BIYKDY+yypCkjIhm/ClRADJY4Yb/ZsNEAAAAABJRU5ErkJgggAA';

        const update = async (path: string, name: string, mime: string) => {
            file.downloadURL = path;
            file.name = name;
            file.mime = mime;
            console.log('updated', path, name, mime);
        }

        const get: GetFileNameFunction = async (downloadURI: string) => {
            return 'testingfilename-for-expect';
        }

        uploadServer = new LocalUploadServer({
            port: TEST_PORT,
            domain: `http://localhost:${TEST_PORT}`,
            uploadPath: uploadPath,
        });
        uploadServer.setResolver(get);
        await uploadServer.launch();

        const url = await uploadServer.provisionUploadURI(file, update);

        const form = new FormData();
        form.append("data", Buffer.from(fileData), { knownLength: 344 });

        const headers = {
            ...form.getHeaders(),
            "Content-Length": form.getLengthSync()
        };

        const request = await axios.post(`${url}`, form, { headers });
        expect(request).toHaveProperty(['data', 'status'], 'OK');

        const download = await axios.get(url.replace('upload', 'download'));
        console.log(download);
        expect(download.status).toEqual(200);
        expect(download.headers).toHaveProperty('content-disposition');
        expect(download.headers['content-disposition']).toContain('testingfilename-for-expect');
        expect(download.data).toEqual(fileData);
    });
})
