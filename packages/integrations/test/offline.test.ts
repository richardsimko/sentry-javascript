// TODO: Fix all tests once moved to a separate plugin package
/* eslint-disable @typescript-eslint/ban-ts-comment */

import { Event, EventProcessor, Hub, Integration } from '@sentry/types';
import * as utils from '@sentry/utils';

import { Offline } from '../src/offline';

// mock localforage methods
jest.mock('localforage', () => ({
  createInstance(_options: { name: string }): any {
    let items: { key: string; value: Event }[] = [];

    return {
      // @ts-ignore
      async getItem(key: string): Event {
        // @ts-ignore
        return items.find(item => item.key === key);
      },
      // @ts-ignore
      async iterate(callback: () => void): void {
        items.forEach((item, index) => {
          // @ts-ignore
          callback(item.value, item.key, index);
        });
      },
      // @ts-ignore
      async length(): number {
        return items.length;
      },
      // @ts-ignore
      async removeItem(key: string): void {
        items = items.filter(item => item.key !== key);
      },
      // @ts-ignore
      async setItem(key: string, value: Event): void {
        items.push({
          key,
          value,
        });
      },
    };
  },
}));

let integration: Integration & {
  offlineEventStore: any;
};
let online: boolean;

describe.skip('Offline', () => {
  describe('when app is online', () => {
    beforeEach(() => {
      online = true;

      initIntegration();
    });

    it('does not store events in offline store', async () => {
      setupOnce();
      processEvents();

      expect(await integration.offlineEventStore.length()).toEqual(0);
    });

    describe('when there are already events in the cache from a previous offline session', () => {
      beforeEach(done => {
        const event = { message: 'previous event' };

        integration.offlineEventStore
          .setItem('previous', event)
          .then(() => {
            done();
          })
          .catch((error: Error) => error);
      });

      it('sends stored events', async () => {
        expect(await integration.offlineEventStore.length()).toEqual(1);

        setupOnce();
        processEvents();

        expect(await integration.offlineEventStore.length()).toEqual(0);
      });
    });
  });

  describe('when app is offline', () => {
    beforeEach(() => {
      online = false;
    });

    it('stores events in offline store', async () => {
      initIntegration();
      setupOnce();
      prepopulateEvents(1);
      processEvents();

      expect(await integration.offlineEventStore.length()).toEqual(1);
    });

    it('enforces a default of 30 maxStoredEvents', done => {
      initIntegration();
      setupOnce();
      prepopulateEvents(50);
      processEvents();

      setImmediate(async () => {
        // allow background promises to finish resolving
        expect(await integration.offlineEventStore.length()).toEqual(30);
        done();
      });
    });

    it('does not purge events when below the maxStoredEvents threshold', done => {
      initIntegration();
      setupOnce();
      prepopulateEvents(5);
      processEvents();

      setImmediate(async () => {
        // allow background promises to finish resolving
        expect(await integration.offlineEventStore.length()).toEqual(5);
        done();
      });
    });

    describe('when maxStoredEvents is supplied', () => {
      it('respects the configuration', done => {
        initIntegration({ maxStoredEvents: 5 });
        setupOnce();
        prepopulateEvents(50);
        processEvents();

        setImmediate(async () => {
          // allow background promises to finish resolving
          expect(await integration.offlineEventStore.length()).toEqual(5);
          done();
        });
      });
    });

    describe('when connectivity is restored', () => {
      it('sends stored events', async done => {
        initIntegration();
        setupOnce();
        prepopulateEvents(1);
        processEvents();
        processEventListeners();

        expect(await integration.offlineEventStore.length()).toEqual(0);

        setImmediate(done);
      });
    });
  });
});

let eventListeners: any[];
let eventProcessors: EventProcessor[];
let events: Event[];

function addGlobalEventProcessor(callback: EventProcessor): void {
  eventProcessors.push(callback);
}

function getCurrentHub(): Hub {
  return {
    captureEvent(_event: Event): string {
      return 'an-event-id';
    },
    // @ts-ignore
    getIntegration(_integration: Integration): any {
      // pretend integration is enabled
      return true;
    },
  };
}

function initIntegration(options: { maxStoredEvents?: number } = {}): void {
  eventListeners = [];
  eventProcessors = [];
  events = [];

  // @ts-ignore
  utils.getGlobalObject = jest.fn(() => ({
    // @ts-ignore
    addEventListener: (_windowEvent, callback) => {
      eventListeners.push(callback);
    },
    navigator: {
      onLine: online,
    },
  }));

  integration = new Offline(options);
}

function prepopulateEvents(count: number = 1): void {
  for (let i = 0; i < count; i++) {
    events.push({
      message: 'There was an error!',
      timestamp: new Date().getTime(),
    });
  }
}

function processEventListeners(): void {
  eventListeners.forEach(listener => {
    listener();
  });
}

function processEvents(): void {
  eventProcessors.forEach(processor => {
    events.forEach(event => {
      processor(event) as Event | null;
    });
  });
}

function setupOnce(): void {
  integration.setupOnce(addGlobalEventProcessor, getCurrentHub);
}
