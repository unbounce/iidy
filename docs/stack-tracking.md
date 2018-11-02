# iidy CloudFormation Stack Tracking

## Problem

- Remembering all the parameters for creating or updating a CloudFormation stack
  can be difficult
- Communicating and ensuring that a CloudFormation stack has been fully rolled
  out after a change can be difficult
  - Finding a way to push this into a CI workflow would resolve this issue
  - I essentially want [Atlantis](https://www.runatlantis.io/) but for
    CloudFormation
- With many AWS regions and accounts, it is difficult to know whether all
  instances of a stack have been updated
- StackSets kind of suck

## Solution

Track the iidy arguments for existing CloudFormation stacks:

```
$ iidy create-stack --track stack-args.yaml --profile ... --region ... --environment ...
```

This will create the stack and will create a tracking file in the same directory
directory as the args file (under `.iidy/`). That particular stack can be
recalled using an interactive prompt:

```
$ iidy update-existing
  [ ] iidy update-stack stack-args.yaml --profile ... --region ... --environment ...
  [ ] iidy update-stack stack-args.yaml --profile ... --region ...
  [ ] iidy update-stack stack-args.other.yaml --profile ... --region ... --environment ...

  [ ] Update all
```

which will allow the developer to select the arguments for an existing stack.

The stack tracking files will be committed to version control to share between
developers and so that they are available in CI.

### Different Workflows

Update existing stacks only for a given stack args file:

```
iidy update-existing stack-args.yaml
```

Auto-update (without an interactive prompt) all tracked stacks in the current directory:

```
iidy update-existing -y ...
```

or only for a given environment:

```
iidy update-existing -y --environment production
```

or region

```
iidy update-existing -y --region us-east-1
```

or use changesets to apply the changes (may be useful for safely applying changes in CI):

```
iidy update-existing -y --changeset
```

Checking status of existing CloudFormation stacks:

```
iidy status

stack-name-1
  <Stack metadata>
  <CloudFormation template diff>
  <StackSet changes>

stack-name-2
  <Stack metadata>
  <CloudFormation template diff>
  <StackSet changes>
```

## Tracking File Format

Filename:

```
hash(<stack-args filename> + <CLI args: region, profile, environment> + imported ENV variables + AWS_PROFILE etc).yaml
```

Contents:

```
stack_args: stack-args.yaml
args:
  - --environment production
  - --region us-east-1
  - --profile sandbox
env:
  APP_VERSION: ... # for example
  AWS_PROFILE: ... # if this environment variable was set when `iidy create-stack --track` was run
```

Questions:

- Perhaps AWS profiles should be resolved down to the IAM role they use? In that
  case, what about MFA?
  - AWS CLI profiles are not always configured with the same name or in the same
    way
  - Requiring that developers keep a standard set of profiles would be the
    easiest solution to this problem
- How do you override parameters, such as an application version?
