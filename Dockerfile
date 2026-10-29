FROM node:22.23.4-alpine

WORKDIR /tmp/iidy

COPY . .

# TODO use PKG_CACHE_PATH to cache the pkg downloads

RUN apk update && apk add --no-cache git \
  && npm ci . && npm run build \
  && npx pkg --out-path dist -t node22-alpine-x64 package.json
# No strip pass: pkg-fetch checks the cached base binary's hash and re-fetches
# a stripped one, so stripping it saves nothing.

FROM alpine:3.24

RUN apk --no-cache add libstdc++ git

COPY --from=0 /tmp/iidy/dist/iidy /usr/local/bin/iidy

ENTRYPOINT ["/usr/local/bin/iidy"]
