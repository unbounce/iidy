FROM node:9-alpine

WORKDIR /tmp/iidy

COPY . .

RUN yarn --frozen-lockfile && ln -s /tmp/iidy/bin/iidy /usr/bin/

ENTRYPOINT ["/usr/bin/iidy"]

