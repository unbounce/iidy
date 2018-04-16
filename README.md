# iidy (Is it done yet?) -- a CloudFormation CLI tool

(Note: this is written assuming an Unbounce developer is the reader and we
previously used Ansible for orchestrating CloudFormation.)

`iidy` improves the developer experience with CloudFormation and
CloudFormation templates.

* It provides immediate, readable feedback about what CloudFormation
  is doing and any errors it encounters.
* Its single binary is simpler to install than Ansible's Python
  dependencies.
* It is far simpler to learn, understand, and use. There are fewer
  moving parts and its commands map directly to CloudFormation's.
* It requires less boilerplate files and directories. 2 or 3 files vs
  5+ directories with 7+ files.
* It has simple, reliable support for AWS profiles.
* It supports the full range of CloudFormation operations, including
  _changesets_ without requiring any code beyond what is required to
  create a stack. Ansible requires additional code/configuration for
  this.
* It does some template validation, guards against common issues, and
  will be extended over time to validate our best practices and
  security policies.
* It provides seemless integration with AWS ParameterStore, our choice
  for secret management going forward and our replacement for Ansible
  Vault.
* It includes an optional YAML pre-processor which allows
  CloudFormation templates to be abstracted and simplified in ways not
  possible with vanilla CloudFormation templates. The pre-processor
  language supports importing data from a variety of external sources
  and this allows a better separation of concerns than is possible
  with stock CloudFormation without resorting to Lambda-backed custom
  resources. See the [pre-processor documentation
  below](#yaml-pre-processing) for more details.
* It has bash command completion support.

## Pronunciation

iidy is pronounced "eye-dee", like the audience's response to Cab Calloway in Minnie the
Moocher: https://www.youtube.com/watch?v=8mq4UT4VnbE&feature=youtu.be&t=50s

## Demo
[![asciicast](https://asciinema.org/a/8rzW1WyoDxMdVJpvpYf2mHm8E.png)](https://asciinema.org/a/8rzW1WyoDxMdVJpvpYf2mHm8E)

Here's a comparison between developer experience of `iidy` and `Ansible`
when you run into errors with a CloudFormation stack:
[![asciicast](https://asciinema.org/a/jExZ5S8Pk4KzlJiufGoll0rXs.png)](https://asciinema.org/a/jExZ5S8Pk4KzlJiufGoll0rXs?t=45)

## Installation

### MacOS: Binary Install via Homebrew

Use Unbounce's custom Homebrew Tap to install iidy.  This is the preferred method for macos.

```Shell
brew tap unbounce/homebrew-taps
brew update
brew install iidy
```

### Binary Installation on Other Platforms
```Shell
# Grab the appropriate binary from the releases page.
wget https://github.com/unbounce/iidy/releases/download/v1.6.5/iidy-linux-amd64.zip
# or wget https://github.com/unbounce/iidy/releases/download/v1.6.5/iidy-macos-amd64.zip
unzip iidy*.zip
chmod +x iidy
mv iidy /usr/local/bin/   # or somewhere more appropriate
```

### Installation from Source

Counter-intuitively, this requires more disk space than the binary
install. You need Node 7+ and npm 4+ installed.

```Shell
git clone git@github.com:unbounce/iidy.git
cd iidy
npm install . && npm run build # to compile our source first
ln -s $(pwd)/bin/iidy /usr/local/bin/
# or npm install -g .
```

## Usage

### Help
```
$ iidy help
iidy - CloudFormation with Confidence                    An acronym for "Is it done yet?"

Commands:
  create-stack  <argsfile>                               create a cfn stack based on stack-args.yaml
  update-stack  <argsfile>                               update a cfn stack based on stack-args.yaml
  estimate-cost <argsfile>                               estimate aws costs based on stack-args.yaml

  create-changeset           <argsfile> [changesetName]  create a cfn changeset based on stack-args.yaml
  exec-changeset             <argsfile> <changesetName>  execute a cfn changeset based on stack-args.yaml

  describe-stack      <stackname>                        describe a stack
  watch-stack         <stackname>                        watch a stack that is already being created or updated
  delete-stack        <stackname>                        delete a stack (after confirmation)
  get-stack-template  <stackname>                        download the template of a live stack
  get-stack-instances <stackname>                        list the ec2 instances of a live stack
  list-stacks                                            list all stacks within a region

  param                                                  sub commands for working with AWS SSM Parameter Store

  render <template>                                      pre-process and render YAML template
  demo   <demoscript>                                    run a demo script
  convert-stack-to-iidy <stackname> <outputDir>          create an iidy project directory from an existing CFN stack
  init-stack-args                                        initialize stack-args.yaml and cfn-template.yaml

  completion                                             generate bash completion script. To use: "source <(iidy completion)"

AWS Options
  --client-request-token  a unique, case-sensitive string of up to 64 ASCII characters used to ensure idempotent retries.
  --region                AWS region. Can also be set via --environment & stack-args.yaml:Region.
  --profile               AWS profile. Can also be set via --environment & stack-args.yaml:Profile.

Options:
  --environment, -e  used to load environment based settings: AWS Profile, Region, etc.
  --debug            log debug information to stderr.
  -v, --version      show version information
  -h, --help         show help
```

### The `argsfile` (aka `stack-args.yaml`)

```YAML
####################
# Required settings:

StackName: <string>

Template: <local file path or s3 path>

# optionally you can use the YAML pre-processor by prepending 'render:' to the filename
#Template: render:<local file path or s3 path>


####################
# Optional settings:

Region: <aws region name>

Profile: <aws profile name>

Tags: # aws tags to apply to the stack
  owner: Tavis
  environment: development
  project: iidy-docs
  lifetime: short

Parameters: # stack parameters
  key1: value
  key2: value

Capabilities: # optional list. *Preferably empty*
  - CAPABILITY_IAM
  - CAPABILITY_NAMED_IAM

NotificationARNs:
  - <sns arn>

# CloudFormation ServiceRole
ServiceRoleARN: arn:aws:iam::<acount>:role/<rolename>

TimeoutInMinutes: <number>

# OnFailure defaults to ROLLBACK
OnFailure: 'ROLLBACK' | 'DELETE' | 'DO_NOTHING'

StackPolicy: <local file path or s3 path>

ResourceTypes: <list of aws resource types allowed in the template>
  # see http://docs.aws.amazon.com/cli/latest/reference/cloudformation/create-stack.html#options

CommandsBefore: # shell commands to run prior the cfn stack operation
  - make build # for example

```

### AWS IAM Settings

`iidy` supports loading AWS IAM credentials/profiles from a) the cli
options shown above, b) `Region` or `Profile` settings in
`stack-args.yaml`, or c) the standard AWS environment variables. You
will also need the correct level of IAM permissions for `iidy` to
perform CloudFormation API calls.

Additionally, the [YAML pre-processing](#yaml-pre-processing)
`$imports` that pull data from AWS (`cfn`, `s3`, `ssm`, and
`ssm-path`) depend on `iidy` being wired to the correct AWS user /
role and region. You will also need the correct level of IAM
permissions for `iidy` to make the API calls these `$imports` rely on.

### Listing and Describing Live Stacks

[![asciicast](https://asciinema.org/a/l4vDhmKiTLr10oKypXRG7y1eW.png)](https://asciinema.org/a/l4vDhmKiTLr10oKypXRG7y1eW)

### Creating or Updating CloudFormation Stacks

[![asciicast](https://asciinema.org/a/8rzW1WyoDxMdVJpvpYf2mHm8E.png)](https://asciinema.org/a/8rzW1WyoDxMdVJpvpYf2mHm8E)

```Shell
$ tree examples/hello-world
examples/hello-world
├── stack-args.yaml         # see above
├── cfn-template.yaml # a vanilla cloudformation template

$ cd examples/hello-world/

$ cat stack-args.yaml
StackName: iidy-demo
Template: ./cfn-template.yaml # details are irrelevant for the demo
Tags:
  owner: your-name
  project: iidy-demo
  environment: development
  lifetime: short

$ iidy create-stack stack-args.yaml
# ... lots of useful output about what iidy and CloudFormation are doing ...

$ iidy list-stacks | grep iidy-demo
Wed Aug 02 2017 00:41:49 CREATE_COMPLETE          iidy-demo owner=tavis, environment=development, lifetime=short, project=iidy-demo

# edit something in stack-args to demo a simple update-stack
sed s/your-name/Tavis/ stack-args.yaml > stack-args2.yaml

$ iidy update-stack stack-args2.yaml
# ... lots of useful output about what iidy and CloudFormation are doing ...

$ iidy list-stacks | grep iidy-demo
Wed Aug 02 2017 00:45:49 UPDATE_COMPLETE          iidy-demo owner=Tavis, environment=development, lifetime=short, project=iidy-demo

$ iidy describe-stack iidy-demo
# ... more details ...

$ iidy delete-stack iidy-demo
# ... confirm Yes ...


```


### Creating or Executing CloudFormation Changesets

[![asciicast](https://asciinema.org/a/fl9ss0EYyPbDtFmSCaERC2YBU.png)](https://asciinema.org/a/fl9ss0EYyPbDtFmSCaERC2YBU)

### Using Parameter Store for secrets and ARNs

Here's an example of importing a single secret from Parameter Store.
```YAML
# example stack-args.yaml
$imports:
  dbPasswd: ssm:/staging/lp-webapp/dbPasswd
  # the ssm: prefix ^ is used to ask for a ssm:parameterstore import

StackName: iidy-demo
Template: ./cfn-template.yaml
Parameters:
  DbPasswd: !$ dbPasswd
  ...
```
See below for more on `$imports` and `includes` (i.e. the `!$` YAML tag).


You can also import the full set of parameters under a path prefix:
```YAML
# example stack-args.yaml
$imports:
  secrets: ssm-path:/staging/lp-webapp/
  # ssm-path: prefix ^ grabs all parameters under that path
  # and makes them accessible as a key-value map.

StackName: iidy-demo
Template: ./cfn-template.yaml
Parameters:
  DbPasswd: !$ secrets.dbPasswd
  SomeOtherPasswd: !$ secrets.otherPasswd
  ...
```



## YAML Pre-Processing

In additional to wrapping the Cloudformation API / workflow, `iidy`
provides an optional YAML pre-processor, which

* allows CloudFormation templates to be abstracted and simplified in
  ways not possible with vanilla CloudFormation templates
* allows values to be imported from a range of sources, including
  local files, s3, https, ParameterStore, and environment variables.
  It parses json or YAML imports. The imported data can be stitched
  into the target template as YAML subtrees, as literal strings, or as
  single values.
* can be used to define custom resource templates that expand out
  to a set of real AWS resources. These templates can be parameterized
  and can even do input validation on the parameters. The template
  expansion and validation happens as a pre-process step prior to
  invoking CloudFormation on the rendered output.

It can be used on CloudFormation template files, `stack-args.yaml`,
and any other YAML file. The pre-processor is applied automatically to
`stack-args.yaml` and optionally to CloudFormation templates by
prefixing the Template value in `stack-args.yaml` with `render:` as
shown below.

```YAML
StackName: iidy-demo
Template: "render:./cfn-template.yaml"
Parameters:
  Foo: bar
```



The pre-processor can also be invoked directly on any YAML file via the
`iidy render` cli command.

### Basic Syntax

The pre-processor language is valid YAML with some [custom
tags](http://yaml.org/spec/1.0/#id2490971). These tags all start with
the characters `!$`. There are also a few special map keys, starting
with `$`. Both sets of YAML extensions are explained below.

This documentation assumes you already know YAML syntax well. See
https://en.wikipedia.org/wiki/YAML#Syntax or
http://www.yaml.org/spec/1.2/spec.html for help.

### `$imports`, `$defs`, and Includes

Each YAML document is treated as a module with a distinct namespace.
Values in a namespace are defined via the `$defs:` entry at the root
of the document or are imported via the `$imports:` entry.

These values can be accessed and stitched into the output using either
the `!$` (pronounced "include") custom tag or with handlebarsjs syntax
inside a string entry.

```YAML
# input document
$defs:
  hello: "world"

output:
  by-tag: !$ hello
  by-handlebars: "{{hello}}"

---
# output document
output:
  by-tag: "world"
  by-handlebars: "world"

```

Note that the braces used with the handlebars syntax must be enclosed
in a quoted string or the YAML parser will treat them as a YAML map node.

If the value being included is a map or list rather than a simple
scalar value, it is spliced into the output rather than being
collapsed in any way.

```YAML
# input document
$defs:
  a-list:
    - 1
    - 2
  a-map:
    k1: v1
    k2: v2
  a-string: "foo"
  a-number: 1
  a-bool: false

output:
  a-list: !$ a-list
  a-map: !$ a-map
  a-string: !$ a-string
  a-number: !$ a-number
  a-bool: !$ a-bool

---
# output document
output:
  a-list:
    - 1
    - 2
  a-map:
    k1: v1
    k2: v2
  a-string: "foo"
  a-number: 1
  a-bool: false

```

The entries in `$defs:` may use values from `$imports:` and an import
source may contain handlebars syntax which refers to either values
that have come from `$defs` or from previous `$imports`.

For example, `values` in this set of imports depends on `other`:
```YAML
$imports:
  other: "env:other:default"
  values: "{{other}}.yaml"
```

This example is simillar to the previous but `other` is defined as a fixed value.
```YAML
$defs:
  other: blah
$imports:
  values: "{{other}}.yaml"
```

#### Sources for `$imports`

Imports are specified per YAML document under the special
document-level key `$imports`. Its value is map from import names to
import sources.

For example, if we had the following file:
```YAML
# names.yaml
mundi: world
#...
```

We could import it into another file and use the values it contains:
```YAML
# input document
$imports:
  # <an arbitrary import name>: <importSource>
  names: ./names.yaml

output:
  hello: !$ names.mundi
---
# output document
outputs:
  hello: world

```

`iidy` supports a wide range of import sources:

* local file paths (relative or absolute): e.g. `./some-file.yaml`
* filehash: e.g. `filehash:./some-file.yaml`
* https or http: e.g. `https://example.com/some-file.yaml`
* environment variables: e.g. `env:FOO` or with an optional default value `env:FOO:bar`
* s3 (tied to an AWS account / region): e.g.
  `s3://somebucket/some-file.yaml`. Requires `s3:GetObject` IAM
  permissions.
* CloudFormation stacks (tied to an AWS account / region). These
  require requires IAM `cloudformation:ListExports` and
  `cloudformation:DescribeStack` permissions.
  * `cfn:export:someExportName`
  * `cfn:output:stackName:anOutputName` or `cfn:output:stackName` imports all outputs
  * `cfn:resource:stackName:resourceName` or `cfn:resource:stackName` imports all resources
  * `cfn:parameter:stackName:parameterName` or `cfn:parameter:stackName` imports all parameters
  * `cfn:tag:stackName:tagName` or `cfn:tag:stackName` imports all tags
  * `cfn:stack:stackName` imports all stack details from the CloudFormation API
* AWS SSM ParameterStore (tied to an AWS account / region). These
  require IAM `ssm:GetParameters`, `ssm:GetParameter`, and
  `ssm:DescribeParameter` permissions.
  * `ssm:/some-path-prefix/foo`: a single entry
  * `ssm-path:/some-path-prefix/`: all entries under a path prefix
* random
  * `random:int`
  * `random:dashed-name`
  * `random:name`
* git
  * `git:branch`
  * `git:describe`
  * `git:sha`

`iidy` parses `.yaml` or `.json` imports and makes them available as a
map. It uses either the file extension or the mime-type of remote
files to detect these file types.

Relative imports are supported for local files, http, and s3.

### Boolean / Logical Branching Tags
TODO: see the test suite for now
* `!$if`
* `!$eq`
* `!$not`


### Looping and Data Restructuring Tags
TODO: see the test suite for now
* `!$concat` concatenate lists of lists
* `!$map` map a YAML template over a list of input arguments
* `!$concatMap` same as `!$map` followed by `!$concat` on the output
* `!$merge` merge a list of maps together, similar to lodash [`_.merge`](https://lodash.com/docs/4.17.4#merge)
* `!$mergeMap` same as `!$map` followed by `!$merge` on the output
* `!$fromPairs` convert a list of pairs into a map
* `!$groupBy` similar to lodash [`_.merge`](https://lodash.com/docs/4.17.4#groupBy)
* `!$split` split a string into a list

### String manipulation Tags
TODO: see the test suite for now
* `!$parseYaml` parse a string

### Working With CloudFormation YAML
`iidy` autodetects whether a YAML document is a CloudFormation
template or not. If it is, the [`custom resource templates`](#custom-resource-templates) (described
below) and some validation/normalization features are enabled.

#### Custom Resource Templates


NOTE: this section is work in progress

Before we get into the details here's a simple -- and rather pointless
-- example. We define a custom template `demo-custom-template.yaml`
which has two `$params` and outputs two `Resources`. Then in
`demo-cnf-template.yaml` we import the custom template and use it as
the `Type:` in the `Demo` resource.

```YAML
# demo-custom-template.yaml
$params:
  - Name: Foo
    Type: string
  - Name: Bar
    Type: string
Resources:
  Topic1:
    Type: AWS::SNS::Topic
    Properties:
      DisplayName: "Hello {{Foo}}"
  Topic2:
    Type: AWS::SNS::Topic
    Properties:
      DisplayName: "Hello {{Bar}}"

```

```YAML
# demo-cfn-template.yaml
$imports:
  DemoTmpl: demo-custom-template.yaml
  # ^ the name is arbitrary
Resources:
  Demo:
    Type: DemoTmpl # use it here
    Properties:
      # these are threaded in as the $params defined in demo-custom-template.yaml
      Foo: 123
      Bar: 456
  SomeOtherResource:
    Type: AWS::SNS::Topic
    Properties:
      DisplayName: "non-custom"
```

We can use `iidy render demo-cfn-template.yaml` to see the final
template:

```YAML
AWSTemplateFormatVersion: '2010-09-09'
Resources:
  DemoTopic1:
    Type: 'AWS::SNS::Topic'
    Properties:
      DisplayName: Hello 123
  DemoTopic2:
    Type: 'AWS::SNS::Topic'
    Properties:
      DisplayName: Hello 456
  SomeOtherResource:
    Type: 'AWS::SNS::Topic'
    Properties:
      DisplayName: non-custom
Metadata: # ... elided ...
```

TODO: more examples and cover the details
TODO: This section is best explained with an worked example / executable demonstration

### Working with *Non*-CloudFormation YAML

`iidy render` can be used to invoke the pre-processor on any YAML
document. All features are available other than [`custom resource
templates`](#custom-resource-templates). See `iidy render --help` for
some more information.

### Converting Deployed Stacks to `iidy`
Converting current stacks to `iidy` can be done through the `iidy convert-stack-to-iidy` command,
which accepts 2 parameters: `stackname` (the stack name of the project that you'd want to convert) and
an `outputDir` (path where the output will be stored). For example:

```Shell
iidy convert-stack-to-iidy my-cloudformation-stack-1 ./infrastructure

# this should generate 3 files:
# * _original-template.json
# * stack-args.yaml
# * cfn-template.yaml
```

## Examples
See the examples/ directory.


## Development

iidy is coded in Typescript and compiles to es2015 Javascript using
commonjs modules (what Node uses). See the `Makefile` and the script
commands in `package.json` for details about the build process.

Please format all files with `tsfmt` and remove extra whitespace
before submitting a PR.

## License
MIT.

## Changelog
* [v1.6.5](https://github.com/unbounce/iidy/releases/tag/v1.6.5)

* [v1.6.4](https://github.com/unbounce/iidy/releases/tag/v1.6.4)

* [v1.6.3](https://github.com/unbounce/iidy/releases/tag/v1.6.3)

* [v1.6.2](https://github.com/unbounce/iidy/releases/tag/v1.6.2)

* [v1.6.1](https://github.com/unbounce/iidy/releases/tag/v1.6.1)
  - fix bug with `iidy param` commands (#50)

* [v1.6.0-rc7](https://github.com/unbounce/iidy/releases/tag/v1.6.0-rc7)
  - add `iidy template-approval` commands (#43)
  - sign S3-hosted, http template URLs (#39)
  - fix bug with `render:` template detection (#39)
  - fix bug with `cfn:export` imports containing colon (#33)

* [v1.6.0-rc6](https://github.com/unbounce/iidy/releases/tag/v1.6.0-rc6)
  - a variety of new preprocessor features and `iidy init-stack-args` -- December 10, 2017

* [v1.6.0-rc5](https://github.com/unbounce/iidy/releases/tag/v1.6.0-rc5)
  - work around bug in aws-sdk re presence of ~/.aws & add support for reusing
    aws cli sts role cache -- November 22, 2017

* [v1.6.0-rc4](https://github.com/unbounce/iidy/releases/tag/v1.6.0-rc4)
  - Minor bug fix & new `cfn:export:name` import type -- November 20, 2017

* [v1.6.0-rc3](https://github.com/unbounce/iidy/releases/tag/v1.6.0-rc3)
  - New features & a bug fix -- November 7, 2017

* [v1.6.0-rc2](https://github.com/unbounce/iidy/releases/tag/v1.6.0-rc2)
  - A few tweaks / enhancements on rc1 -- November 6, 2017

* [v1.6.0-rc1](https://github.com/unbounce/iidy/releases/tag/v1.6.0-rc1)
  - Getting ready for the biggest release yet -- November 5, 2017

* [v1.5.0](https://github.com/unbounce/iidy/releases/tag/v1.5.0) A bit
  - of polish plus dependency updates -- September 1, 2017

* [v1.4.0](https://github.com/unbounce/iidy/releases/tag/v1.4.0)
  - get-stack-instances command, improved error reporting -- August 24, 2017

* [v1.3.3](https://github.com/unbounce/iidy/releases/tag/v1.3.3) Bug
  - fixes and input validation -- August 22, 2017

* [v1.3.2](https://github.com/unbounce/iidy/releases/tag/v1.3.2)
  Internal refactoring -- August 15, 2017

* [v1.3.1](https://github.com/unbounce/iidy/releases/tag/v1.3.1) Added
  - time since last event to the event polling output. -- August 11, 2017

* [v1.3.0](https://github.com/unbounce/iidy/releases/tag/v1.3.0) More
  - robust time handling / event filtering to protect against local clock drift.
    Also there's now a Dockerfile for creating a small Alpine based container
    image. -- August 10, 2017

* [v1.2.0](https://github.com/unbounce/iidy/releases/tag/v1.2.0) CLI
  - output is prettier, new `demo` command, `--role-arn` option for
    `delete-stack`, add missing `prepublish` entry to `package.json`, improved
    handling of aws region in cli output. -- August 8, 2017

* [v1.1.0](https://github.com/unbounce/iidy/releases/tag/v1.1.0) Docs,
  - examples, and improvements -- August 3, 2017

* [v1.0.0](https://github.com/unbounce/iidy/releases/tag/v1.0.0)
  - Initial Release -- August 1, 2017


## Release

- Update `version` in `package.json`
- Run `npm install`
- Run `git add package.json package-lock.json`
- Run `git commit -m 'v1.0.0'` with correct version number
- Run `git tag -a v1.0.0 -m 'v1.0.0'` with correct version number
- Run `git push origin v1.0.0` with correct version number
- Run `make release-prepare`
- Create [GitHub release](https://github.com/unbounce/iidy/releases)
- Update [homebrew forumula](https://github.com/unbounce/homebrew-taps/blob/master/iidy.rb)

## Roadmap

In priority order:

* More examples and documentation.

* Unit tests of the pre-processor code. Our current coverage is minimal.
