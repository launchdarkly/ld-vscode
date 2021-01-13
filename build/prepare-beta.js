/* eslint-disable no-undef */
/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-unused-vars */

const fs = require('fs');
const package = require('../package.json');

const dt = new Date;
package.displayName = 'LaunchDarkly Beta'
package.version = `${dt.getUTCFullYear()}.${dt.getUTCMonth()+1}.${dt.getUTCDate()}.${dt.getTime()}`;
fs.renameSync('package.json', 'package.orig.json');
fs.writeFileSync('package.json', JSON.stringify(package));
