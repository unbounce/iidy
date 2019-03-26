# Listing and Describing Live Stacks

[![asciicast](https://asciinema.org/a/l4vDhmKiTLr10oKypXRG7y1eW.png)](https://asciinema.org/a/l4vDhmKiTLr10oKypXRG7y1eW)

# Creating or Updating CloudFormation Stacks

[![asciicast](https://asciinema.org/a/8rzW1WyoDxMdVJpvpYf2mHm8E.png)](https://asciinema.org/a/8rzW1WyoDxMdVJpvpYf2mHm8E)

```shell
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

# Creating or Executing CloudFormation Changesets

[![asciicast](https://asciinema.org/a/fl9ss0EYyPbDtFmSCaERC2YBU.png)](https://asciinema.org/a/fl9ss0EYyPbDtFmSCaERC2YBU)
