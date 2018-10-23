FROM node:10-alpine

WORKDIR /tmp/iidy

COPY . .

RUN apk update && apk add --no-cache git \
    && npm ci . && npm run build && ln -s /tmp/iidy/bin/iidy /usr/bin/

ENTRYPOINT ["/usr/bin/iidy"]

