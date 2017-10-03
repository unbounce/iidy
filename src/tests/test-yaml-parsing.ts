import { assert, expect } from 'chai';

import * as _ from 'lodash';

import * as yaml from '../yaml';
import * as jsyaml from 'js-yaml';

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

  it("can roundtrip basic yaml docs (non-custom)", () => {
    const input = 'a: b\n';
    expect(yaml.dump(yaml.loadString(input, 'root'))).to.deep.equal(input);
  })

});
