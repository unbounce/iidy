# iidy (Is it done yet?) -- a CloudFormation CLI tool

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
Moocher:
https://www.youtube.com/watch?v=8mq4UT4VnbE&feature=youtu.be&t=50s

## Demo
[![asciicast](https://asciinema.org/a/8rzW1WyoDxMdVJpvpYf2mHm8E.png)](https://asciinema.org/a/8rzW1WyoDxMdVJpvpYf2mHm8E)

Here's a comparison between developer experience of `iidy` and `Ansible`
when you run into errors with a CloudFormation stack:
[![asciicast](https://asciinema.org/a/jExZ5S8Pk4KzlJiufGoll0rXs.png)](https://asciinema.org/a/jExZ5S8Pk4KzlJiufGoll0rXs?t=45)

## iidy at Unbounce

`iidy` is a replacement for our use of Ansible as a wrapper around
CloudFormation. It talks to the CloudFormation API directly and
provides good user feedback while waiting for stack operations to
complete. It also uses AWS ParameterStore to replace our use of
Ansible Vault for encrypting secrets and ARNs. Ansible still has a
role in server bootstrapping, which is not a concern of `iidy`.

Over time, it will become the sole tool we use for talking to the
CloudFormation API while creating or updating stacks.

Migration from Ansible (+ Vault) or Troposphere to `iidy` will be
**mandatory** once the tool has been through some further testing.
However, you won't have to do the work yourself. All dev squads will
be required to accept pull requests that implement this change. These
pull requests will not change the details of your stacks once
provisioned - i.e. they will be low risk and impact tooling only. I
aim to have all production services migrated by the end of Sept 2017.
Ansible usage by Core is not included in this scope. Why and why now?

1) Ansible is an unnecessary layer above CloudFormation that has a bad
UX for this use-case (see above).

2) We want to retire Ansible Vault as our use of it has some security
issues.

3) Our developers have not had a good onboarding experience learning
Ansible and CloudFormation at the same time. It has scared people away
from a good tool - CloudFormation - and given them the impression it
is more complex than it truely is.

4) We do not have the bandwidth to support multiple tools. Unlike
previous introductions of new tools, we are cleaning house of the old
tools before moving on.

5) This is a step to some broader changes to the way we
provision infrastructure. It will simplify the path towards a) a
secure production account with no `#superuser` required for
deployments, b) proper separation between `staging` and `production`,
c) some architectural normalization that Roman and others are working
on. More information will be coming on these topics later.

Use of the yaml pre-processor is **completely optional**. If you use it,
please share your experiences with me.

How does this relate to `Simple Infrastructure`? It's orthogonal and
complimentary. They solve different problems and can be used together.
Like all existing production stacks, `Simple Infrastructure` should be
updated to use this rather than Ansible. I am working on a pull
request.

Who supports and maintains it? Tavis. I will be providing extensive
examples, documentation, and training. Pull requests and feature
requests are welcome.

Isn't this an example of NIH syndrome? Roman and I built a prototype
of this back in Dec. 2015. We searched for good alternatives then and
found none. I researched roughly a dozen other tools prior to
restarting work on this. Unfortunately, there are non that a) are well
documented and supported, b) have a good UX / developer experience, c)
are integrated with ParameterStore, d) expose the full CloudFormation
api, and most importantly e) are simple and unopinionated.

## Installation

* Binary installation. This is the preferred method.
```
# Grab the appropriate binary from the releases page.
# (Wget won't work while this is a private repo)
open https://github.com/unbounce/iidy/releases/download/v1.3.1/iidy-macos.gz # or -linux.gz

cd ~/Downloads                # or wherever Linux puts it
gunzip iidy*.gz
chmod +x iidy*
mv iidy* /usr/local/bin/iidy   # or somewhere more appropriate
```

* Installing from source if you have node installed.
  Counter-intuitively, this requires more disk space than the binary
  install.

```
# You need Node 6 or above installed.
git clone git@github.com:unbounce/iidy.git
cd iidy
npm install . # to compile our source first
npm install -g .
```

## Usage

### Help
```
$ iidy help
iidy (Is it done yet?) -- a tool for working with CloudFormation and yaml templates

Stack Commands:
  create-stack <argsfile>                                create a cloudformation stack
  update-stack <argsfile>                                update a cloudformation stack
  create-changeset <changesetName> <argsfile>            create a cfn changeset
  create-stack-via-changeset <changesetName> <argsfile>  create a new stack via a cfn changeset
  exec-changeset <changesetName> <argsfile>              execute a cfn changeset
  estimate-cost <argsfile>                               estimate stack costs based on stack-args.yaml
  watch-stack <stackname>                                watch a stack that is already being created or updated
  describe-stack <stackname>                             describe a stack
  get-stack-template <stackname>                         download the template of a live stack
  delete-stack <stackname>                               delete a stack (after confirmation)
  list-stacks                                            list the stacks within a region

Additional Commands:
  render <template>                                      pre-process and render cloudformation yaml templates
  completion                                             generate bash completion script

AWS Options
  --region   AWS region
  --profile  AWS profile

Options:
  -v, --version  Show version number
  -h, --help     Show help

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
  owner: tavis
  project: iidy-demo
  environment: development
  lifetime: short

$ iidy create-stack-via-changeset initialset stack-args.yaml
# ... lots of useful output about what iidy and CloudFormation are doing ...

$ iidy describe-stack iidy-demo
# ... a complete description of the pending stack

$ iidy exec-changeset initialset stack-args.yaml
# ... lots of useful output about what iidy and CloudFormation are doing ...

$ iidy list-stacks | grep iidy-demo
Wed Aug 02 2017 00:51:49 CREATE_COMPLETE          iidy-demo owner=tavis, environment=development, lifetime=short, project=iidy-demo

# edit something in stack-args to demo a simple update-stack
sed s/tavis/Tavis/ stack-args.yaml > stack-args2.yaml

$ iidy create-changeset change1 stack-args2.yaml
# ... lots of useful output about what iidy and CloudFormation are doing ...

$ iidy execute-changeset change1 stack-args2.yaml
# ... lots of useful output about what iidy and CloudFormation are doing ...

$ iidy list-stacks | grep iidy-demo
Wed Aug 02 2017 00:55:49 UPDATE_COMPLETE          iidy-demo owner=Tavis, environment=development, lifetime=short, project=iidy-demo

$ iidy describe-stack iidy-demo
# ... more details ...

$ iidy delete-stack iidy-demo
# ... confirm Yes ...
```

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
* environment variables
* AWS SSM ParameterStore
* git
* random
* literal



### Working With CloudFormation Yaml

#### Custom CloudFormation Resource Types
...

### Working with *Non*-CloudFormation Yaml
`iidy` autodetects whether a Yaml document is a CloudFormation
template or not. If it's not, the CloudFormation custom resource
templates described above and some validation/normalization features
are disabled. Everything else should work as described above.

## Examples
See the examples/ directory.


## Development

iidy is coded in Typescript and compiles to es2015 Javascript using
commonjs modules (what Node uses). See the `Makefile` and the script
commands in `package.json` for details about the build process.

...

## Changelog

* v1.3.1 Added time since last event to the event polling output. --
  August 11, 2017

* v1.3.0 More robust time handling / event filtering to protect
  against local clock drift. Also there's now a Dockerfile for
  creating a small Alpine based container image. -- August 10, 2017

* v1.2.0: CLI output is prettier, new `demo` command, `--role-arn`
  option for `delete-stack`, add missing `prepublish` entry to
  `package.json`, improved handling of aws region in cli output. --
  August 8, 2017

* v1.1.0: Docs, examples, and improvements -- August 3, 2017

* v1.0.0: Initial Release -- August 1, 2017


## Roadmap

...
