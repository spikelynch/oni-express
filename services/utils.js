const fs = require('fs-extra');

const sleep = ms => new Promise((r, j) => {
  setTimeout(r, ms * 1000);
});

async function readConf(logger, portalcf) {
  try {
    const conf = await fs.readJson(portalcf);
    return conf;
  } catch (e) {
    logger.info(`Portal conf ${portalcf} not found`);
    return null;
  }
}

module.exports = {sleep, readConf};