.PHONY : test

.DEFAULT_GOAL := test

test:
	@mkdir -p demo-tmp/
	@iidy render stack-args.yaml > demo-tmp/stack-args.yaml
	@grep StackName demo-tmp/stack-args.yaml | cut -f 2 -d':' > demo-tmp/stack-name
	@cp cfn-template.yaml demo-tmp/

	@./.wrap-bash iidy create-stack demo-tmp/stack-args.yaml

	@./.wrap-bash iidy list-stacks --region us-west-2 --profile sandbox | grep $$(cat demo-tmp/stack-name)

	@./.wrap-bash sed -i.bak s/your-name/Tavis/ demo-tmp/stack-args.yaml
	@./.wrap-bash iidy update-stack demo-tmp/stack-args.yaml

	@./.wrap-bash iidy delete-stack --region us-west-2 --profile sandbox --yes $$(cat demo-tmp/stack-name)

	@rm -r demo-tmp
