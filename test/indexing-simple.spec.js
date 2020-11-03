
const expect = require('chai').expect;
const _ = require('lodash');
const path = require('path');
const fs = require('fs-extra');
const dc = require('docker-compose');
const axios = require('axios');
const uuid = require('uuid').v4;
const Repository = require('ocfl').Repository;
const ROCrate = require('ro-crate').ROCrate;
const defaults = require('ro-crate').Defaults;
const randomWord = require('random-word');

const RETRIES = 20;
const SLEEP = 5000;
const HTTP_TIMEOUT = 60000;

const DOCKER_ROOT = path.join(process.cwd(), 'test-data', 'indexing');
const OCFL = path.join(DOCKER_ROOT, 'ocfl');
const WORKING = path.join(DOCKER_ROOT, 'working');

const SOLR_URL = "http://localhost:8983/solr/ocfl/select?q=id%3A";

// FIXME - portal isn't getting config refreshed, but I don't need to
// solve that now

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


async function make_repo() {
  await fs.remove(OCFL);
  await fs.mkdir(OCFL);
  const repository = new Repository();
  const init = await repository.create(OCFL);
  return repository;
}

function random_int(min, max) {
  return min + Math.floor(Math.random() * (max + 1 - min));
}

function random_words(min, max) {
  const n = random_int(min, max);
  const words = [];
  for ( let i = 0; i < n; i++ ) {
    words.push(randomWord());
  }
  return words;
}


// async function load_vocabs (dir) {
//   const sourcedata = {};
//   sourcedata['surnames'] = await loadsource(path.join(dir, 'surname.txt'));
//   sourcedata['givennames'] = await loadsource(path.join(dir, 'givenname.txt'));
//   return sourcedata;
// }


async function make_crates(ocfl, n) {
  await fs.remove(WORKING);
  await fs.mkdir(WORKING);

  // const names = await load_vocabs(path.join(DOCKER_ROOT, 'vocabularies'));

  const crates = {};

  const keywords = random_words(10, 20);

  for( let i = 0; i < n; i++ ) {
    const id = uuid();
    const workingDir = path.join(WORKING, id); 
    await fs.mkdir(workingDir);
    const crate = new ROCrate({
      '@context': defaults.context,
      '@graph': [
        defaults.metadataFileDescriptorTemplate,
        {
          '@type': 'Dataset',
          '@id': './',
          'name': random_words(1, 5).map(_.upperFirst).join(' '),
          'description' : random_words(40, 100).join(' '),
          'keywords': _.sampleSize(keywords, random_int(2, 8))
        }
      ]
    });

    await fs.writeJSON(path.join(workingDir, 'ro-crate-metadata.json'), crate.json_ld);
    await ocfl.importNewObjectDir(id, workingDir);
    console.log(`Created OCFL object ${id}`);
    crates[id] = crate;
    crates[id].index();
  }

  return crates;
}



async function indexer_stopped() {
  let ps;
  let i = 0;
  do {
    // Note: docker-compose only applies --filter if you include the
    // --services flag: see https://github.com/docker/compose/issues/5996
    await sleep(SLEEP);
    try {
      ps = await dc.ps({
        cwd: DOCKER_ROOT,
        commandOptions: [
          [ "--filter", "status=running" ],
          [ "--services" ]
        ]
      });
    } catch (e) {
      console.log(`Error getting ps output:`);
      console.log(e);
    }
    i += 1;
    if( i > RETRIES ) {
      console.log(`Exceeded max retries waiting for oni-indexer`);
      return false;
    }
  } while ( ps.out.match(/oni-indexer/) );
  return true;
}



describe('basic indexing', function () {
  this.timeout(0);

  let crates;

  before(async function () {

    await dc.stop({ cwd: DOCKER_ROOT, log: true});
    const repo = await make_repo();
    crates = await make_crates(repo, 20);
    console.log(`Starting docker-compose in ${DOCKER_ROOT} `);

    await dc.upAll({ cwd: DOCKER_ROOT, log: true});
    const indexed = await indexer_stopped();
    expect(indexed).to.be.true;

  });

  it('can index simple ro-crates and retrieve them via solr', async function () {

    for( let id in crates ) {
      console.log(`Fetching ${id} from Solr`);
      const resp = await axios({
        url: SOLR_URL + id,
        method: 'get',
        responseType: 'json',
        timeout: HTTP_TIMEOUT,
        headers: {
          'Content-Type': 'application/json; charset=utf-8'
        }
      });
      expect(resp).to.not.be.null;
      expect(resp.status).to.equal(200);
      const solrResp = resp.data;
      expect(solrResp.response.numFound).to.equal(1);
      const solrDoc = solrResp.response.docs[0];
      const dataset = crates[id].getRootDataset();
      expect(solrDoc.name[0]).to.equal(dataset.name);
      expect(solrDoc.description).to.equal(dataset.description);
      expect(solrDoc.keywords).to.deep.equal(dataset.keywords);
    }

  });




});
