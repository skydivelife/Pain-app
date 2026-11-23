'use strict';
// Pluggable model providers. Add another (Hive, Reality Defender, your own
// model) by exporting { name, configured(), scoreImage(path, mime) }.
const providers = [require('./sightengine')];

function active() {
  return providers.find((p) => p.configured()) || null;
}

module.exports = { active };
