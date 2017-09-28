//tslint:disable no-any
import * as _ from 'lodash';
import * as jsyaml from 'js-yaml';

type YamlKind = 'scalar' | 'mapping' | 'sequence';

export class Tag {
  ctor: any // see below re fugly
  constructor(public data: any) {
    this.ctor = new.target;
  }
  
  update(data: any): Tag {
    // fugly but can't call new.target from here. This is equivalent
    // to this.constructor in plain js.
    return new this.ctor(data);
  }
}

function mkTagClass(tag_name: string) {
  return class AnonTag extends Tag {
    tag_name = tag_name;
  }
}

const schemaTypes: jsyaml.Type[] = [];
export const customTags: {[key: string]: typeof Tag} = {};

type Resolver = any;

function addCFNTagType(tag_name: string, kind: YamlKind, resolve?: Resolver) {
  const kls = _.has(customTags, tag_name) ? customTags[tag_name] : mkTagClass(tag_name);
  customTags[tag_name] = kls;
  schemaTypes.push(new jsyaml.Type('!' + tag_name, {
    kind: kind,
    instanceOf: kls,
    resolve: resolve,
    construct: (data: any) => new kls(data),
    represent: (node: Tag) => node.data
  }));
}

// http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/intrinsic-function-reference.html

addCFNTagType('Base64', 'scalar');
addCFNTagType('Base64', 'mapping');

addCFNTagType('FindInMap', 'sequence');

addCFNTagType('GetAtt', 'scalar');
addCFNTagType('GetAtt', 'sequence');

addCFNTagType('GetAZs', 'scalar');
addCFNTagType('GetAZs', 'mapping');
addCFNTagType('GetAZs', 'sequence');

addCFNTagType('ImportValue', 'scalar');
addCFNTagType('ImportValue', 'mapping');

addCFNTagType('Join', 'sequence');

export class Ref extends Tag {}
customTags.Ref = Ref;

addCFNTagType('Ref', 'scalar');
addCFNTagType('Ref', 'sequence');

addCFNTagType('Select', 'sequence');

addCFNTagType('Sub', 'scalar');
addCFNTagType('Sub', 'sequence');
addCFNTagType('Sub', 'mapping');


// http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/continuous-delivery-codepipeline-action-reference.html
addCFNTagType('GetParam', 'sequence');

// http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/intrinsic-function-reference-conditions.html
addCFNTagType('And', 'sequence');
addCFNTagType('Equals', 'sequence');
addCFNTagType('If', 'sequence');
addCFNTagType('Not', 'sequence');
addCFNTagType('Or', 'sequence');


////////////////////////////////////////////////////////////////////////////////
// custom !$tag support

function addCustomTag(name: string | string[], kls: any, resolve?: Resolver){
  const names = _.isArray(name) ? name : [name];
  for (const nm of names) {
    customTags[nm] = kls
    // add all even if primitive types even if only a subset is valid as
    // the error reporting is better handled elsewhere.
    addCFNTagType(nm, 'scalar', resolve);
    addCFNTagType(nm, 'sequence', resolve);
    addCFNTagType(nm, 'mapping', resolve);
  }
}

////////////////////////////////////////////////////////////////////////////////
// basic interpolation related custom tags

export class $include extends Tag {}
addCustomTag(['$include', '$'], $include); // scalar

export class $escape extends Tag {}
addCustomTag('$escape', $escape); // any

export class $string extends Tag {}
addCustomTag('$string', $string); // any

export class $parseYaml extends Tag {}
addCustomTag('$parseYaml', $parseYaml); // scalar string

////////////////////////////////////////////////////////////////////////////////
// variable definition and template expansion custom tags

export class $let extends Tag {}
addCustomTag('$let', $let); // mapping

export class $expand extends Tag {}
addCustomTag('$expand', $expand); // mapping

////////////////////////////////////////////////////////////////////////////////
// looping and data restructuring custom tags

export class $map extends Tag {}
addCustomTag('$map', $map); // mapping

export class $mapListToHash extends Tag {}
addCustomTag('$mapListToHash', $mapListToHash); // mapping

export class $flatten extends Tag {}
addCustomTag('$flatten', $flatten); // sequence

export class $concatMap extends Tag {}
addCustomTag('$concatMap', $concatMap); // mapping

export class $fromPairs extends Tag {}
addCustomTag('$fromPairs', $fromPairs); // mapping

////////////////////////////////////////////////////////////////////////////////
const schema = jsyaml.Schema.create(schemaTypes);

export const loadString = (content: string | Buffer, filename: string) : any =>
  jsyaml.safeLoad(content.toString(), {schema: schema, filename: filename});

export const dump = (doc: object) : string => 
  jsyaml.safeDump(doc, {schema: schema})
  .replace(/!<!([^>]+?)>/g, '!$1');
