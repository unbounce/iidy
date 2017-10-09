import {expect} from 'chai';
import * as _ from 'lodash';
import * as jsyaml from 'js-yaml';

import * as pre from '../index';
import * as yaml from '../yaml';

// TODO test various bad paths & error handling

import {
  transform,
  transformNoImport,
  mkMockImportLoader,
  $let
} from './support';

const waitConditionTemplate = {
  Resources: {
    blah:
    {
      Type: 'AWS::CloudFormation::WaitConditionHandle',
      Properties: {}
    }
  }
};

function assertNo$GutsLeakage(output: pre.CfnDoc) {
  expect(output).not.to.have.property('$defs');
  expect(output).not.to.have.property('$imports');
  expect(output).not.to.have.property('$params');
  expect(output).not.to.have.property('$envValues');
}


describe("Yaml pre-processing", () => {

  describe("basics", () => {

    it("leaves input documents unchanged", async () => {
      for (const input of [
        {},
        {foo: 123},
        waitConditionTemplate
      ]) {
        const inputClone = _.clone(input);
        await transform(input);
        // and again with the non-async post import form
        transformNoImport(input);
        expect(input).to.deep.equal(inputClone);
      }

    });

    it("is a no-op for empty documents", async () => {
      const input = {};
      expect(await transform(input)).to.deep.equal(input);
      expect(transformNoImport(input)).to.deep.equal(input);
    });

    it("autodetects Cloudformation yaml templates", async () => {
      for (const input of [
        {Resources: {}},
        {Resources: {}, $defs: {a: 'b'}},
        waitConditionTemplate,
        {AWSTemplateFormatVersion: '2010-09-09'}
      ]) {
        const output = await transform(input);
        expect(output).to.deep.include(_.omit(input, ['$defs']));
        expect(output).to.have.property('AWSTemplateFormatVersion');
        expect(output).to.have.property('Metadata');
        assertNo$GutsLeakage(output);
      }
    });

  });


  describe("$imports:", () => {

    it("importLoader mocking works", async () => {
      const testDoc = {
        $imports: {a: 's3://mock/mock1'},
        literal: 1234,
        aref: new yaml.$include('a')
      };
      const expected = {aref: 'mock', literal: 1234};
      const mockLoader = mkMockImportLoader(
        {
          's3://mock/mock1': {data: 'mock'},
          's3://mock/mock2': {data: '', doc: testDoc}
        });
      expect(await transform(testDoc, mockLoader))
        .to.deep.equal(expected);

      expect(await transform({
        $imports: {nested: 's3://mock/mock2'},
        literal: new yaml.$include('nested.literal')
      },
        mockLoader))
        .to.deep.equal({literal: 1234});

      expect(await transform(
        `
$imports: {nested: 's3://mock/mock2'}
aref: !$ nested.aref`, mockLoader)).to.deep.equal({aref: 'mock'});

    });
  });

  describe("$defs:", () => {

    it("basic usage with !$ works", async () => {

      expect(await transform({$defs: {a: 'b'}, out: "{{a}}"}))
        .to.deep.equal({out: 'b'});

      expect(await transform({$defs: {a: 'b'}, out: new yaml.$include('a')}))
        .to.deep.equal({out: 'b'});

      expect(await transform({$defs: {a: {b: 'c'}}, out: "{{a.b}}"}))
        .to.deep.equal({out: 'c'});

      expect(await transform({
        $defs: {a: new yaml.$include('b'), b: 'xref'},
        out: new yaml.$include('a')
      }))
        .to.deep.equal({out: 'xref'});
    });
  });

  describe("!$let", () => {
    it("basic usage of !$let & !$ works", async () => {
      expect(await transform({out: $let({a: 'b', in: "{{a}}"})}))
        .to.deep.equal({out: 'b'});

      expect(await transform({out: $let({a: 'b', in: new yaml.$include('a')})}))
        .to.deep.equal({out: 'b'});

      expect(await transform({out: $let({a: {b: 'c'}, in: {inner: "{{a.b}}"}})}))
        .to.deep.equal({out: {inner: 'c'}});
    });


    it.skip("xrefs", async () => {
      expect(await transform(
        {
          out: $let({
            a: new yaml.$include('b'),
            b: 'xref',
            in: {inner: new yaml.$include('a')}
          })
        }))
        .to.deep.equal({out: {inner: 'xref'}});
    });

  });


  describe("!$fromPairs", () => {

    it("basic forms", async () => {
      expect(await transform(`
out: !$fromPairs
  - key: a
    value: 1
  - key: b
    value: 2
  - key: c
    value: 3
`
      )).to.deep.equal(jsyaml.load(`
out:
  a: 1
  b: 2
  c: 3`));

    });

  });

  describe("!$flatten", () => {
    // TODO rename to !$concat
    it("basic forms", async () => {

      expect(await transform(`
out: !$flatten
  - [1,2,3]
  - [4,5,6]
`
      )).to.deep.equal(jsyaml.load(`out: [1,2,3,4,5,6]`));

    });

  });

  describe("!$map", () => {
    const simpleMapRendered = {m: [{v: 1}, {v: 2}, {v: 3}]};
    it("basic forms", async () => {
      expect(await transform(`
m: !$map
  items: [1,2,3]
  template: !$ item
`)).to.deep.equal({m: [1, 2, 3]});

      expect(await transform(`
m: !$map
  items: [1,2,3]
  template:
    v: !$ item
`)).to.deep.equal(simpleMapRendered);

      expect(await transform(`
m: !$map
  items:
    - v: 1
    - v: 2
    - v: 3
  template:
    v: !$ item.v
`)).to.deep.equal(simpleMapRendered);

      expect(await transform(`
m: !$map
  items:
    - v: {sub: 1}
    - v: {sub: 2}
    - v: {sub: 3}
  template:
    v: !$ item.v.sub
`)).to.deep.equal(simpleMapRendered);

      expect(await transform(`
ports: !$map
  template:
    CidrIp: "0.0.0.0/0"
    FromPort: !$ item
    ToPort: !$ item
  items: [80, 443]`
      )).to.deep.equal(jsyaml.load(`
ports:
  - CidrIp: 0.0.0.0/0
    FromPort: 80
    ToPort: 80
  - CidrIp: 0.0.0.0/0
    FromPort: 443
    ToPort: 443`));

    });

    it("var", async () => {
      expect(await transform(`
m: !$map
  var: i
  items:
    - v: {sub: 1}
    - v: {sub: 2}
    - v: {sub: 3}
  template:
    v: !$ i.v.sub
`)).to.deep.equal(simpleMapRendered);

    });
  });

  describe("!$concatMap", () => {

    it("basic forms", async () => {

      expect(await transform(`
nested: !$concatMap
  items: [80, 443]
  var: port
  template: !$map
    var: cidr
    items: ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"]
    template:
      CidrIp:   !$ cidr
      FromPort: !$ port
      ToPort:   !$ port
`
      )).to.deep.equal(jsyaml.load(`
nested:
  - CidrIp: 10.0.0.0/8
    FromPort: 80
    ToPort: 80
  - CidrIp: 172.16.0.0/12
    FromPort: 80
    ToPort: 80
  - CidrIp: 192.168.0.0/16
    FromPort: 80
    ToPort: 80
  - CidrIp: 10.0.0.0/8
    FromPort: 443
    ToPort: 443
  - CidrIp: 172.16.0.0/12
    FromPort: 443
    ToPort: 443
  - CidrIp: 192.168.0.0/16
    FromPort: 443
    ToPort: 443`));


    });

  });

  describe("!$mapListToHash", () => {

    it("basic forms", async () => {
      expect(await transform(`
out: !$mapListToHash
  template:
    key: !$ item.0
    value: !$ item.1
  items:
    - ['a', "v1"]
    - ['b', "v2"]`
      )).to.deep.equal(jsyaml.load(`
out:
  a: v1
  b: v2`));

    });

    it("var", async () => {
      expect(await transform(`
out: !$mapListToHash
  var: i
  template:
    key: !$ i.0
    value: !$ i.1
  items:
    - ['a', "v1"]
    - ['b', "v2"]`
      )).to.deep.equal(jsyaml.load(`
out:
  a: v1
  b: v2`));

    });


  });


});