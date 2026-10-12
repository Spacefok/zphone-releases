import {build,Platform} from 'electron-builder';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
await build({targets:Platform.WINDOWS.createTarget(['nsis']),config:require('../electron-builder.cjs'),publish:'never'});
