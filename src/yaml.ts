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
    return new this.ctor(data); // fugly but can't call new.target from here
  }
}

function mkTagClass(tag_name: string) {
  return class AnonTag extends Tag {
    tag_name = tag_name;
  }
}

const schemaTypes: jsyaml.Type[] = [];
export const customTags: {[key: string]: typeof Tag} = {};

function addCFNTagType(tag_name: string, kind: YamlKind) {
  const kls = _.has(customTags, tag_name) ? customTags[tag_name] : mkTagClass(tag_name);
  customTags[tag_name] = kls;
  schemaTypes.push(new jsyaml.Type('!' + tag_name, {
    kind: kind,
    instanceOf: kls,
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

addCFNTagType('GetAZs', 'sequence');

addCFNTagType('ImportValue', 'scalar');

addCFNTagType('Join', 'sequence');

export class Ref extends Tag {
  update(data: any): Ref {return new Ref(data);}
}
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


// custom

export class $include extends Tag {
  update(data: any): $include {return new $include(data);}
}
customTags.$include = $include;
customTags.$ = $include;
addCFNTagType('$include', 'scalar');
addCFNTagType('$', 'scalar');

export class $escape extends Tag {
  update(data: any): $escape {return new $escape(data);}
}
customTags.$escape = $escape;
addCFNTagType('$escape', 'scalar');
addCFNTagType('$escape', 'sequence');

export class $string extends Tag {
  update(data: any): $string {return new $string(data);}
}
customTags.$string = $string;
addCFNTagType('$string', 'scalar');
addCFNTagType('$string', 'sequence');
addCFNTagType('$string', 'mapping');

export class $expand extends Tag {
  update(data: any): $expand {return new $expand(data);}
}
customTags.$expand = $expand;
addCFNTagType('$expand', 'mapping');
// scalar and sequence are invalid uses but there error is better reported elsewhere
addCFNTagType('$expand', 'scalar');
addCFNTagType('$expand', 'sequence');

export class $let extends Tag {
  update(data: any): $let {return new $let(data);}
}
customTags.$let = $let;
addCFNTagType('$let', 'mapping');
// scalar and sequence are invalid uses but there error is better reported elsewhere
addCFNTagType('$let', 'scalar');
addCFNTagType('$let', 'sequence');

export class $parseYaml extends Tag {
  update(data: any): $parseYaml {return new $parseYaml(data);}
}
customTags.$parseYaml = $parseYaml;
addCFNTagType('$parseYaml', 'scalar');
// mapping and sequence are invalid uses but there error is better reported elsewhere
addCFNTagType('$parseYaml', 'mapping');
addCFNTagType('$parseYaml', 'sequence');


const schema = jsyaml.Schema.create(schemaTypes);

export const loadString = (content: string | Buffer, filename: string) : any =>
  jsyaml.safeLoad(content.toString(), {schema: schema, filename: filename});

export const dump = (doc: object) : string => 
  jsyaml.safeDump(doc, {schema: schema})
  .replace(/!<!([^>]+?)>/g, '!$1');
