/* eslint-disable no-undef */
/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-unused-vars */

const fs = require('fs');
const package = require('../package.json');

const dt = new Date();
package.name = 'launchdarkly-beta';
package.displayName = 'LaunchDarkly Beta';
package.version = `${dt.getUTCFullYear()}.${dt.getUTCMonth() + 1}.${Math.floor(dt.getTime() / 1000)}`;
fs.renameSync('package.json', 'package.orig.json');
fs.writeFileSync('package.json', JSON.stringify(package));
