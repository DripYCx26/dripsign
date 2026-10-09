import { test } from 'node:test';
import { nativeJourney } from './nativeJourney.ts';
test('staff and a recipient negotiate, publish, sign and download on one host', async () => { await nativeJourney(); });
