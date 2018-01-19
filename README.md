# iidy (Is it done yet?) -- a CloudFormation CLI tool

(Note: this is written assuming an Unbounce developer is the reader and we
previously used Ansible for orchestrating CloudFormation.)

`iidy` improves the developer experience with CloudFormation.

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
* It has bash command completion support.

`iidy` also improves the developer experience working with CloudFormation
Yaml templates. It includes an optional yaml pre-processor that:

* allows values to be imported from a range of sources, including
  local files, s3, https, ParameterStore, and environment variables.
  It parses json or yaml imports. The imported data can be stitched
  into the target template as yaml subtrees, as literal strings, or as
  single values.
* can be used to define custom resource templates that expand out
  to a set of real AWS resources. These templates can be parameterized
  and can even do input validation on the parameters. The template
  expansion and validation happens as a pre-process step prior to
  invoking CloudFormation on the rendered output.

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

```
brew tap unbounce/homebrew-taps
brew update
brew install iidy
```

### Binary Installation on Other Platforms
```
# Grab the appropriate binary from the releases page.
wget https://github.com/unbounce/iidy/releases/download/v1.6.0-rc6/iidy-linux-amd64.zip
# or wget https://github.com/unbounce/iidy/releases/download/v1.6.0-rc6/iidy-macos-amd64.zip
unzip iidy*.zip
chmod +x iidy
mv iidy /usr/local/bin/   # or somewhere more appropriate
```

### Installation from Source

Counter-intuitively, this requires more disk space than the binary
install. You need Node 7+ and npm 4+ installed.

```
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

  render <template>                                      pre-process and render yaml template
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

```
####################
# Required settings:

StackName: <string>

Template: <local file path or s3 path>

# optionally you can use the yaml pre-processor by prepending 'render:' to the filename
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
RoleARN: arn:aws:iam::<acount>:role/<rolename>

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
    `stack-args.yaml`, or c) the standard environment variables.

### Listing and Describing Live Stacks

[![asciicast](https://asciinema.org/a/l4vDhmKiTLr10oKypXRG7y1eW.png)](https://asciinema.org/a/l4vDhmKiTLr10oKypXRG7y1eW)

### Creating or Updating CloudFormation Stacks

[![asciicast](https://asciinema.org/a/8rzW1WyoDxMdVJpvpYf2mHm8E.png)](https://asciinema.org/a/8rzW1WyoDxMdVJpvpYf2mHm8E)

```
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
```
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
See below for more on `$imports` and `includes` (i.e. the `!$` yaml tag).


You can also import the full set of parameters under a path prefix:
```
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



## Yaml Pre-Processing
...

### Imports and Includes

```
# Example of stitching in values from another yaml file
$imports:
  # <importName>: <importSource>
  mappings: ./mappings.yaml

Mappings: !$ mappings
```

#### Import Source Options

* file
* filehash
* s3
* https
* git
* random
* environment variables
* CloudFormation stacks
* AWS SSM ParameterStore

### Working With CloudFormation Yaml

#### Custom CloudFormation Resource Types
...

### Working with *Non*-CloudFormation Yaml
`iidy` autodetects whether a Yaml document is a CloudFormation
template or not. If it's not, the CloudFormation custom resource
templates described above and some validation/normalization features
are disabled. Everything else should work as described above.

### Converting Deployed Stacks to `iidy`
Converting current stacks to `iidy` can be done through the `iidy convert-stack-to-iidy` command,
which accepts 2 parameters: `stackname` (the stack name of the project that you'd want to convert) and
an `outputDir` (path where the output will be stored). For example:

```sh
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

...

## License
MIT.

## Changelog
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

* Unit tests of the pre-processor code. I've been relying on types and
  functional tests to date.
