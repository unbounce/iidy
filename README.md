# iidy (Is it done yet?) -- a CloudFormation CLI tool

iidy improves the developer experience with CloudFormation and
CloudFormation templates.

* It provides immediate, readable feedback about what CloudFormation is doing
  and any errors it encounters.
* It is simple to learn, understand, and use.
  parts, that map directly to CloudFormation's
* It has simple, reliable support for AWS profiles.
* It supports the full range of CloudFormation operations, including
  _changesets_ without requiring any code beyond what is required to create a
  stack.
* It does some template validation, guards against common issues, and will be
  extended over time to validate our best practices and security policies.
* It provides seemless integration with AWS Parameter Store
* It includes an optional YAML pre-processor which allows CloudFormation
  templates to be abstracted and simplified in ways not possible with vanilla
  CloudFormation templates. The pre-processor language supports importing data
  from a variety of external sources and this allows a better separation of
  concerns than is possible with stock CloudFormation without resorting to
  Lambda-backed custom resources. See the [pre-processor documentation
  below](#yaml-pre-processing) for more details.
* It has bash command completion support.

## Pronunciation

iidy is pronounced "eye-dee", like the audience's response to Cab Calloway in
[Minnie the Moocher](https://www.youtube.com/watch?v=8mq4UT4VnbE&feature=youtu.be&t=50s).

## Demo

[![asciicast](https://asciinema.org/a/8rzW1WyoDxMdVJpvpYf2mHm8E.png)](https://asciinema.org/a/8rzW1WyoDxMdVJpvpYf2mHm8E)

## Installation

iidy is distributed as a self-contained executable (via [pkg](https://github.com/zeit/pkg)).

### Binary Install for macOS via Homebrew

Use Unbounce's custom Homebrew Tap to install iidy. This is the preferred method for macOS.

```shell
brew tap unbounce/homebrew-taps
brew update
brew install iidy
```

### Binary Installation on Other Platforms

```shell
# Grab the appropriate binary from the releases page.
wget https://github.com/unbounce/iidy/releases/download/v1.6.7/iidy-linux-amd64.zip
# or wget https://github.com/unbounce/iidy/releases/download/v1.6.7/iidy-macos-amd64.zip
unzip iidy*.zip
chmod +x iidy
mv iidy /usr/local/bin/ # or somewhere more appropriate
```

### Installation from Source

Counter-intuitively, this requires more disk space than the binary
install. You need Node 7+ and npm 4+ installed.

```shell
git clone git@github.com:unbounce/iidy.git
cd iidy
npm install && npm run build # to compile our source first
ln -s $(pwd)/bin/iidy /usr/local/bin/
# or npm install -g .
```

### Docker Image

A Docker image is automatically published to [Docker
Hub](https://hub.docker.com/r/unbounce/iidy). The `latest` tag is updated on
merges to the `master` branch. Releases are tagged with their version number.

```shell
docker run unbounce/iidy:v1.6.7
```

## Usage

### Help

```shell
$ iidy help
iidy - CloudFormation with Confidence                    An acronym for "Is it done yet?"

Commands:
  iidy create-stack     <argsfile>                            create a cfn stack based on stack-args.yaml
  iidy update-stack     <argsfile>                            update a cfn stack based on stack-args.yaml
  iidy create-or-update <argsfile>                            create or update a cfn stack based on stack-args.yaml
  iidy estimate-cost    <argsfile>                            estimate aws costs based on stack-args.yaml
       ...
  iidy create-changeset           <argsfile> [changesetName]  create a cfn changeset based on stack-args.yaml
  iidy exec-changeset             <argsfile> <changesetName>  execute a cfn changeset based on stack-args.yaml
       ...
  iidy describe-stack      <stackname>                        describe a stack
  iidy watch-stack         <stackname>                        watch a stack that is already being created or updated
  iidy describe-stack-drift <stackname>                       describe stack drift
  iidy delete-stack        <stackname>                        delete a stack (after confirmation)
  iidy get-stack-template  <stackname>                        download the template of a live stack
  iidy get-stack-instances <stackname>                        list the ec2 instances of a live stack
  iidy list-stacks                                            list all stacks within a region
       ...
  iidy param                                                  sub commands for working with AWS SSM Parameter Store
       ...
  iidy template-approval                                      sub commands for template approval
       ...
  iidy render <template>                                      pre-process and render yaml template
  iidy get-import <import>                                    retrieve and print an $import value directly
  iidy demo   <demoscript>                                    run a demo script
  iidy lint-template   <argsfile>                             lint a CloudFormation template
  iidy convert-stack-to-iidy <stackname> <outputDir>          create an iidy project directory from an existing CFN stack
  iidy init-stack-args                                        initialize stack-args.yaml and cfn-template.yaml
       ...
  iidy completion                                             generate bash completion script. To use: "source <(iidy completion)"

AWS Options:
  --client-request-token  a unique, case-sensitive string of up to 64 ASCII characters used to ensure idempotent retries.         [string] [default: null]
  --region                AWS region. Can also be set via --environment & stack-args.yaml:Region.                                 [string] [default: null]
  --profile               AWS profile. Can also be set via --environment & stack-args.yaml:Profile. Use --profile=no-profile to override values in
                          stack-args.yaml and use AWS_* env vars.                                                                 [string] [default: null]
  --assume-role-arn       AWS role. Can also be set via --environment & stack-args.yaml:AssumeRoleArn. This is mutually exclusive with --profile. Use
                          --assume-role-arn=no-role to override values in stack-args.yaml and use AWS_* env vars.                 [string] [default: null]

Options:
  --environment, -e  used to load environment based settings: AWS Profile, Region, etc.                                  [string] [default: "development"]
  --debug            log debug information to stderr.                                                                           [boolean] [default: false]
  --log-full-error   log full error information to stderr.                                                                      [boolean] [default: false]
  -v, --version      show version information                                                                                                    [boolean]
  -h, --help         show help                                                                                                                   [boolean]

Status Codes:
  Success (0)       Command successfully completed
  Error (1)         An error was encountered while executing command
  Cancelled (130)   User responded 'No' to iidy prompt or interrupt (CTRL-C) was received
```

### Environment Variables

Any parameter used by iidy can be set using `IIDY_{{argname}}`. An example of
this would be changing the default environment from development to production.

```shell
export IIDY_ENVIRONMENT=production
```

### The Args File

Metadata for a CloudFormation stack is kept in a file called the "argsfile"
(typically called `stack-args.yaml`). This file is a parameter for commands like
`iidy create-or-update` or `iidy create-changeset` and is the main source of
data for creating or updating a CloudFormation stack.

#### Required Properties

| Property | Description | Example |
|----------|-------------|---------|
| StackName | CloudFormation stack name | `my-stack` |
| Template | Local, `https` or `s3` location of CloudFormation template | `cfn-template.yaml` |

#### Optional Properties

| Property | Description | Example |
|----------|-------------|---------|
| Region | AWS Region to use, overridden by `--region` and `AWS_REGION` | `us-east-1` |
| Profile | [AWS profile](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-profiles.html) to use, overridden by `--profile` and `AWS_PROFILE` |
| AssumeRoleARN | IAM Role ARN to assume | `arn:aws:iam::1234567890:role/my-role` |
| ServiceRoleARN | [CloudFormation Service Role](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-iam-servicerole.html) to use |
| Tags | Tags to assign to CloudFormation stack | `{ service: my-app }` |
| Parameters | [CloudFormation stack parameters](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/parameters-section-structure.html) to use |
| Capabililites | List of [CloudFormation capabilities to use](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-iam-template.html#using-iam-capabilities) | `CAPABILITY_NAMED_IAM` |
| NotificationARNs | List of [SNS Topic ARNs to send CloudFormation notifications to] | `arn:aws:sns:us-east-1:123467890:my-topic` |
| TimeoutInMinutes | Number of minutes to provide as [timeout to the CloudFormation service](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_CreateStack.html) | `10` |
| OnFailure | options: `ROLLBACK`, `DELETE`, `DO_NOTHING`, default `ROLLBACK` | `DELETE`
| StackPolicy | Location, `https`, or `s3` location of CloudFormation policy document | `policy.json` |
| ResourceTypes | List of [allowed resource types to create in CloudFormation stack](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_CreateStack.html) | `['AWS::EC2::*']` |
| CommandsBefore | List of commands to run before `create-` and `update-stack` commands | `['make build']` |

#### Example

```yaml
StackName: my-stack

Template: cfn-template.yaml

Tags:
  project: iidy-docs

Parameters:
  Param1: value1
  Param2: value2

Capabilities:
  - CAPABILITY_IAM
  - CAPABILITY_NAMED_IAM

TimeoutInMinutes: 10

OnFailure: DELETE

StackPolicy: policy.json

CommandsBefore:
  # a list of shell commands to run prior the cfn stack operation
  # /bin/bash is used if found.
  # handlebars templates in the command strings are preprocessed prior to execution.

  # E.g.
  - make build
```

#### Importing Data

Data can be imported into the stack args file using the `$imports` block.

| Import Type | Description | Example |
|-------------|-------------|---------|
| `file` | Load a local file, JSON and YAML files will be parsed into a data structure | `vars.yaml` |
| `filehash` | Compute a SHA 256 hash of a file's contents | `filehash:path`, `filehash:?filepath` (`?` prefix allows file to be empty)
| `filehash-base64` | Compute a SHA 256 hash of a file's contents, returns Base64 encoded hash | `filehash-base64:path`, `filehash-base64:?filepath` (`?` prefix allows file to be empty)
| `s3` | Fetch an object from S3, JSON and YAML files will be parsed into a data structure | `s3://bucket-name/path/to/file` |
| `cfn:export` | Fetch a [CloudFormation Export](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-stack-exports.html) | `cfn:export:export-name`, `cfn:export:export-name?region=us-east-1` |
| `cfn:output` | Fetch the [Output of a CloudFormation stack](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/outputs-section-structure.html) | `cfn:export:stack-name`, `cfn:export:stack-name?region=us-east-1` |
| `cfn:parameter` | Fetch the value of a parameter of a CloudFormation stack | `cfn:parameter:stack-name/parameter-name`, `cfn:parameter:stack-name/parameter-name?region=us-east-1` |
| `cfn:tag` | Fetch the value of a tag of a CloudFormation stack | `cfn:tag:stack-name/tag-name`, `cfn:tag:stack-name/tag-name?region=us-east-1` |
| `cfn:resource` | Fetch a resource of a CloudFormation stack | `cfn:resource:stack-name/resource-name`, `cfn:resource:stack-name/resource-name?region=us-east-1` |
| `cfn:stack` | Fetch all data of a CloudFormation stack | `cfn:stack:stack-name`, `cfn:stack:stack-name?region=us-east-1` |
| `http` | Fetch a file over HTTP. JSON and YAML files will be parsed into a data structure | `https://example.com/vars.yaml` |
| `env` | Fetch value from environment variable | `env:VERSION`, `env:VERSION:default-value` |
| `git:branch` | Get current git branch name (via `git rev-parse --abbrev-ref HEAD`) | `git:branch` |
| `git:describe` | Get current git description (via `git describe --dirty --tags`) | `git:describe` |
| `git:sha` | Get current git sha name (via `git rev-parse HEAD`) | `git:sha` |
| `random:dashed-name` | Generate a random dashed name, for example: `'uptight-guitar'` | `random:dashed-name` |
| `random:name` | Generate a random dashed name, for example: `'uptightguitar'` | `random:name` |
| `random:int` | Generate a random integer, between 1 and 1000 | `random:int` |
| `ssm` | Fetch a SSM Parameter Store value | `ssm:/path/to/param` |
| `ssm-path` | Fetch all SSM Parameter Store values at a given path | `ssm-path:/path/to/params` |

iidy imports can be accessed using the `!$` YAML tag or using Handlebars
templating. `!$` will insert the data assigned to that variable. Handlebars
templated strings can be used to interpolate values into a string.

iidy parses `.yaml` or `.json` imports and makes them available as a map. It
uses either the file extension or the mime-type of remote files to detect these
file types.

```yaml
$imports:
  params: ssm-path:/my-services/config

Parameters:
  Timeout: $! params.Timeout

Tags:
  StackName: 'my-service'
```

#### Implicit Variables

Some data is automatically set by iidy.

| Variable | Description |
|----------|-------------|
| `iidy.region` | The current AWS region in use |
| `iidy.environment` | Value of the `--environment` flag |

```yaml
StackName: 'my-service-{{ iidy.environment }}'
```

#### Defining Variables

Local variables with file can be specified using the `$defs` block.

```yaml
$defs:
  serviceName: my-service

StackName: '{{ serviceName }}-{{ iidy.environment }}'
```

### AWS IAM Settings

iidy supports loading AWS IAM credentials/profiles from a) the cli
options shown above, b) `Region` and `Profile` or `AssumeRoleArn`
settings in `stack-args.yaml`, or c) the standard AWS environment
variables. You will also need the correct level of IAM permissions for
iidy to perform CloudFormation API calls.

- CLI options (see above)
- `Region` and `Profile` or `AssumeRoleArn` in args file
- standard [AWS environment variables](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-envvars.html)

These credentials are used to interact with the CloudFormation API and to
perform and AWS-related imports.

If your profile requires an MFA token, iidy will prompt for it.

```
? MFA token for arn:aws:iam::002682819933:mfa/example.user: ____
```

If you've assumed a profile prior to running iidy and want to it to ignore
what's specified as `Profile` in `stack-args.yaml` and instead use `AWS_*`
environment variables, set the CLI option `--profile no-profile`.

## Additional Documentation

- [Converting Existing CloudFormation Stacks to iidy](docs/converting-existing-cloudformation-stacks-to-iidy.md)
- [Custom Resource Templates](docs/custom-resource-templates.md)
- [Using Parameter Store](docs/using-parameter-store.md)
- [Working with Non-CloudFormation YAML](docs/working-with-non-cloudformation-yaml.md)
- [Working with StackSets](docs/working-with-stacksets.md)
- [YAML Processing](docs/yaml-preprocessing.md)

## Examples

See the [`examples/`](examples/) directory.

## Development

iidy is coded in Typescript and compiles to ES2015 JavaScript using commonjs
modules (what Node uses). See the `Makefile` and the script commands in
`package.json` for details about the build process.

Please format all files with `tsfmt` and remove extra whitespace before
submitting a PR.

## License

MIT.

## Releasing

- Run `npm version minor|patch`
- Run `git push --tags`
- Run `make prepare_release`
- Create a [GitHub release](https://github.com/unbounce/iidy/releases)
- Update the [homebrew forumula](https://github.com/unbounce/homebrew-taps/blob/master/iidy.rb)

## Roadmap

In priority order:

* More examples and documentation.
* More unit tests of the pre-processor code.
