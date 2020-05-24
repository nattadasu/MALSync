const { expect } = require('chai');
const puppeteer = require('puppeteer-extra');
const pluginStealth = require('puppeteer-extra-plugin-stealth');
const AdblockerPlugin = require('puppeteer-extra-plugin-adblocker');

const fs = require('fs');
const dir = require('node-dir');

const script = fs.readFileSync(`${__dirname}/../dist/testCode.js`, 'utf8');

let testsArray = [];

// Define global variables
let browser;
let browserFull;
const debugging = false;
// var caseTitle = 'Proxer';
var mode = {
  'quite': false,
  'parallel': true,
  'blockLog': true
}

if(process.env.CI) mode.quite = true;

async function getBrowser(headless = true) {
  if(browser && headless) return browser;
  if(browserFull && !headless) return browserFull;

  puppeteer.use(pluginStealth());
  puppeteer.use(AdblockerPlugin());
  let tempBrowser = await puppeteer.launch({ headless: headless });
  if(headless) {
    browser = tempBrowser;
  }else{
    browserFull = tempBrowser;
  }
  return tempBrowser;
}

async function closeBrowser() {
  if(browser) await browser.close();
  if(browserFull) await browserFull.close();
}

var logBlocks = {};
function log(block, text, indetion = 0){
  for(let i = 0; i <= indetion; i++){
    text = '  '+text;
  }
  if(mode.blockLog){
    if(!logBlocks[block]) logBlocks[block] = [];
    logBlocks[block].push(text);
  }else{
    console.log(text);
  }
}

function logEr(block, text, indetion = 0){
  for(let i = 0; i <= indetion; i++){
    text = '  '+text;
  }
  if(mode.blockLog){
    if(!logBlocks[block]) logBlocks[block] = [];
    logBlocks[block].push(text);
  }else{
    console.error(text);
  }
}

function logC(block, text, indetion = 0, color = 'blue'){
  let nColor = 0;
  switch(color) {
    case 'red':
      nColor = 31;
      break;
    case 'blue':
      nColor = 36;
      break;
    case 'green':
      nColor = 32;
      break;
  }
  text = '\x1b['+nColor+'m'+text+'\x1b[0m';
  log(block, text, indetion);
}

function printLogBlock(block) {
  if(mode.blockLog && logBlocks[block]){
    logBlocks[block].forEach(el => {
      console.log(el);
    })
  }
}

async function cdn(page){
  return new Promise((resolve, reject) => {
    setTimeout(async () => {
      const content = await page.evaluate(
        () => document.body.innerHTML,
      );
      if (
        content.indexOf('Why do I have to complete a CAPTCHA?') !== -1
      ) {
        reject('Captcha');
      }
      resolve();
    }, 7000);
  });
}

async function onlineTest(url, page) {
  const [response] = await Promise.all([
    await page.goto(url, { waitUntil: 'networkidle0'}),
  ]);

  if (parseInt(response.headers().status) !== 200) {
    const content = await page.evaluate(() => document.body.innerHTML);
    if (content.indexOf('Why do I have to complete a CAPTCHA?') !== -1) {
      throw 'CAPTCHA';
    }
    throw response.headers().status;
  }
}

async function singleCase(block, test, page, retry = 0) {
  const [response] = await Promise.all([
    page.goto(test.url, { timeout: 0 }),
    page.waitForNavigation({ timeout: 0 }),
  ]);

  await page
    .addScriptTag({
      url:
        'http://ajax.googleapis.com/ajax/libs/jquery/3.5.1/jquery.min.js',
    })
    .catch(() => {
      return page.addScriptTag({
        url:
          'https://ajax.googleapis.com/ajax/libs/jquery/3.5.1/jquery.min.js',
      })

    })
    .catch(() => {
      throw 'jquery could not be loaded';
    });

  await page.addScriptTag({ content: script });
  const text = await page.evaluate(() => MalSyncTest());

  if (text === 'retry') {
    if(retry > 2) throw 'Max retries';
    log(block, 'Retry', 2);
    await cdn(page);
    retry++;
    return singleCase(block, test, page, retry);
  }

  expect(text.sync, 'Sync').to.equal(test.expected.sync);
  expect(text.title, 'Title').to.equal(test.expected.title);
  expect(text.identifier, 'Identifier').to.equal(
    test.expected.identifier,
  );
  if (text.sync) {
    expect(text.episode, 'Episode').to.equal(test.expected.episode);
    var textOverview =
      typeof text.overviewUrl !== 'undefined'
        ? text.overviewUrl.replace(/www[^.]*\./, '')
        : text.overviewUrl;
    var testOverview =
      typeof test.expected.overviewUrl !== 'undefined'
        ? test.expected.overviewUrl.replace(/www[^.]*\./, '')
        : test.expected.overviewUrl;
    expect(textOverview, 'Overview Url').to.equal(
      test.expected.overviewUrl.replace(/www[^.]*\./, ''),
    );
    var textOverview =
      typeof text.nextEpUrl !== 'undefined'
        ? text.nextEpUrl.replace(/www[^.]*\./, '')
        : text.nextEpUrl;
    var testOverview =
      typeof test.expected.nextEpUrl !== 'undefined'
        ? test.expected.nextEpUrl.replace(/www[^.]*\./, '')
        : test.expected.nextEpUrl;
    expect(textOverview, 'Next Episode').to.equal(testOverview);
  }
  if (typeof text.uiSelector !== 'undefined') {
    expect(text.uiSelector === 'TEST-UI', 'UI').to.equal(
      test.expected.uiSelector,
    );
  }
  if (
    typeof text.epList !== 'undefined' &&
    typeof test.expected.epList !== 'undefined'
  ) {
    for (const key in test.expected.epList) {
      expect(
        test.expected.epList[key].replace(/www[^.]*\./, ''),
        `EP${key}`,
      ).to.equal(text.epList[key].replace(/www[^.]*\./, ''));
    }
  }
}

async function testPageCase(block, testPage, page){
  log(block, '');
  log(block, testPage.title);
  let passed = 1;

  try {
    await onlineTest(testPage.url, page);
    logC(block, 'Online', 1);
  }catch(e){
    logC(block, 'Offline', 1);
    log(block, e, 2);
  }
  for (const testCase of testPage.testCases){
    try {
      logC(block, testCase.url, 1);
      await Promise.race([
        singleCase(block, testCase, page),
        new Promise((_, reject) => setTimeout(() => reject('timeout'), 45 * 1000))
      ]);
      logC(block, 'Passed', 2, 'green');
    }catch(e){
      logC(block, 'Failed', 2, 'red');
      if(typeof e.showDiff !== 'undefined') {
        log(block, e.message, 3);
        log(block, 'Recieved: '+e.actual, 4);
        log(block, 'Expected: '+e.expected, 4);
      }else{
        logEr(block, e, 3);
      }
      passed = 0;
    }
  }

  if(!mode.quite || (mode.quite && !passed)) printLogBlock(block);
}

async function loopEl(testPage) {
  //if(testPage.title !== 'Kissanime') continue;
  const b = await getBrowser()
  const page = await b.newPage();
  await page.setViewport({ width: 1920, height: 1080 });


  try {
    await testPageCase(testPage.title, testPage, page);
  }catch(e) {
    console.error(e);
  }

  await page.close();

}

async function initTestsArray() {
  new Promise((resolve, reject) => {
    dir.readFiles(__dirname+'/../../src/', {
      match: /^tests.json$/
    }, function(err, content, next) {
      if (err) throw err;
      testsArray.push(JSON.parse(content));
      next();
    },
    function(err, files){
      if (err) throw err;
      console.log('Test files:',files);
      resolve();
    });
  })
}

main();
async function main() {
  let awaitArray = [];
  let running = 0;
  await initTestsArray();
  if(mode.parallel) {
    await getBrowser()
    for (const testPage of testsArray){
      await new Promise((resolve, reject) => {
        let int;
        int = setInterval(() => {
          if(running < 20) {
            clearInterval(int);
            resolve();
          }
        }, 1000)
      });
      running++;
      awaitArray.push(
        loopEl(testPage).then(() => {
          running--;
        })
      );
    }
    await Promise.all(awaitArray);
  }else{
    for (const testPage of testsArray){
      await loopEl(testPage);
    }
  }

  await closeBrowser();
  process.exit();
}
