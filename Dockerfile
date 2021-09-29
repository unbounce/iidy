FROM node:14-alpine

WORKDIR /tmp/iidy

COPY . .

# TODO use PKG_CACHE_PATH to cache the pkg downloads

RUN apk update && apk add --no-cache binutils git \
  && npm ci . && npm run build \
  && $(npm bin)/pkg --out-path dist -t node14-alpine-x64 package.json \
  && strip /root/.pkg-cache/*/fetched-* \
  && $(npm bin)/pkg --out-path dist -t node14-alpine-x64 package.json
# We run pkg twice. First to grab the base binary then again after we strip it.
# This strips 8Mb off the total image size.

FROM alpine:3.14

RUN apk --no-cache add libstdc++ git

COPY --from=0 /tmp/iidy/dist/iidy /usr/local/bin/iidy

ENTRYPOINT ["/usr/local/bin/iidy"]
