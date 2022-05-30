import fetch from 'cross-fetch';
import type { App, DataAccessorBasedStore, FileSystemResourceLocker, ReadWriteLocker } from '../../src';
import { readableToString, BasicRepresentation } from '../../src';
import { describeIf, getPort } from '../util/Util';
import { getDefaultVariables, getTestConfigPath, getTestFolder, instantiateFromConfig, removeFolder } from './Config';

const port = getPort('ResourceLockCleanup');
const baseUrl = `http://localhost:${port}/`;

describe('A server using locking', (): void => {
  const resourceIdentifier = { path: `${baseUrl}container1/test.txt` };

  describe('in case of file-based locking', (): void => {
    let app: App;
    let store: DataAccessorBasedStore;
    let locker: FileSystemResourceLocker;
    const rootFilePath = getTestFolder(`resource-lock-cleanup`);

    beforeAll(async(): Promise<void> => {
      // Clean the working dir
      await removeFolder(rootFilePath);

      const variables = {
        ...getDefaultVariables(port, baseUrl),
        'urn:solid-server:default:variable:rootFilePath': rootFilePath,
      };

      // Create the server
      const instances = await instantiateFromConfig(
        'urn:solid-server:test:Instances',
        [
          getTestConfigPath('server-file-lock.json'),
        ],
        variables,
      ) as Record<string, any>;
      ({ app, store, locker } = instances);

      // Call locker.initialize() manually, so we can create a test resource
      await locker.initialize();
      // Create the test resource
      await store.setRepresentation(resourceIdentifier, new BasicRepresentation('abc', 'text/plain'));
    });

    afterAll(async(): Promise<void> => {
      // Stop the server
      await app.stop();

      // Clean the working dir
      await removeFolder(rootFilePath);
    });

    it('should not be affected by dangling locks.', async(): Promise<void> => {
      // Simulate lock existing before server startup, by creating a (write) lock directly
      await locker.acquire({ path: `${resourceIdentifier.path}.write` });

      // Start the server
      await app.start();

      // Updating the resource should succeed (if the server clears dangling locks on startup).
      const updatedContent = 'def';
      const result = await fetch(resourceIdentifier.path, {
        method: 'PUT',
        headers: {
          'content-type': 'text/plain',
        },
        body: updatedContent,
      });
      expect(result.status).toBe(205);
      const representation = await store.getRepresentation(resourceIdentifier);
      const data = await readableToString(representation.data);
      expect(data).toEqual(updatedContent);
    });
  });

  describeIf('docker', 'in case of redis-based locking', (): void => {
    let app: App;
    let store: DataAccessorBasedStore;
    let locker: ReadWriteLocker;

    beforeAll(async(): Promise<void> => {
      const variables = {
        ...getDefaultVariables(port, baseUrl),
      };

      // Create the server
      const instances = await instantiateFromConfig(
        'urn:solid-server:test:Instances',
        [
          getTestConfigPath('server-redis-lock.json'),
        ],
        variables,
      ) as Record<string, any>;
      ({ app, store, locker } = instances);

      // Create the test resource
      await store.setRepresentation(resourceIdentifier, new BasicRepresentation('abc', 'text/plain'));
    });

    afterAll(async(): Promise<void> => {
      // Stop the server
      await app.stop();
    });

    it('should not be affected by dangling locks.', async(): Promise<void> => {
      // Simulate lock existing before server startup, by creating a (write) lock directly
      const promise = locker.withWriteLock(resourceIdentifier, async(): Promise<void> => {
        // Start the server
        await app.start();

        // Updating the resource should succeed (if the server clears dangling locks on startup).
        const updatedContent = 'def';
        const result = await fetch(resourceIdentifier.path, {
          method: 'PUT',
          headers: {
            'content-type': 'text/plain',
          },
          body: updatedContent,
        });
        expect(result.status).toBe(205);
        const representation = await store.getRepresentation(resourceIdentifier);
        const data = await readableToString(representation.data);
        expect(data).toEqual(updatedContent);
      });
      // Expect Redis reply error, as the test writeLock is removed upon server startup.
      await expect(promise).rejects.toThrow('Error trying to release writelock that did not exist.');
    });
  });
});
