//import { suite, test, slow, timeout } from "mocha-typescript";
import { assert, expect } from 'chai';

import * as _ from 'lodash';

import * as pre from '../index';
import * as yaml from '../yaml';
import * as jsyaml from 'js-yaml';

async function transform(input: any) {
  return pre.transform(input, "root");
}

const waitConditionTemplate = {
  Resources: {blah:
              {Type:'AWS::CloudFormation::WaitConditionHandle',
               Properties:{}}}};

const simpleNonCustomTagYamlDoc = `
a: 12342
b: [1,2]
c:
  d: blah
e:
 - one
 - two
 - 3
`;
const simpleNonCustomTagYamlParsed = jsyaml.load(simpleNonCustomTagYamlDoc);

describe("Yaml pre-processing", () => {

  it("leaves input documents unchanged", async () => {
    for (const input of [
      {},
      {foo: 123},
      waitConditionTemplate
    ]) {

      const inputClone = _.clone(input);
      await transform(input);
      expect(input).to.deep.equal(inputClone);
    }

  });

  it("is a no-op for empty documents", async () => {
    const input = {};
    const output = await transform(input);
    expect(output).to.deep.equal(input);
  });

  it("autodetects Cloudformation yaml templates", async () => {

    for (const input of [
      {Resources: {}},
      waitConditionTemplate,
      {AWSTemplateFormatVersion: '2010-09-09'}
    ]) {
      const output = await transform(input);
      expect(output).to.deep.include(input);
      expect(output).to.have.property('AWSTemplateFormatVersion');
      expect(output).to.have.property('Metadata');
    }

  });

});

describe("Yaml parsing", () => {

  it("can handle empty docs", () => {
    // TODO do these behaviors make sense
    expect(yaml.loadString("", "root")).to.equal(undefined);
    expect(yaml.loadString("---", "root")).to.equal(null);
  });


  it("can handle basic yaml types", () => {
    // This test ensures our custom schema hasn't broken the basics
    expect(yaml.loadString(simpleNonCustomTagYamlDoc, "root"))
      .to.deep.equal(simpleNonCustomTagYamlParsed);
  });

  it.skip("can handle roundtrip basic yaml docs (non-custom)", () => {
    // This test ensures our custom schema hasn't broken the basics

    expect(1).to.deep.equal(1);
  })
});

// this syntax requires "experimentalDecorators": true in tsconfig.json
// @suite class TestTwo {
//   @test method() {
//     throw new Error;
//   }
// }
