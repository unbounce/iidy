FROM node:7-alpine

WORKDIR /tmp/iidy

COPY . .

RUN npm install . \
  && npm run build \
  && $(npm bin)/pkg --out-path dist -t node7-alpine-x64 package.json

FROM alpine:3.6

RUN apk --no-cache add libstdc++

COPY --from=0 /tmp/iidy/dist/iidy /iidy

ENTRYPOINT ["/iidy"]
