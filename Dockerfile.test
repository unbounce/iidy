FROM ubuntu
RUN apt-get update && \
    apt-get install -y make git

COPY iidy /usr/local/bin
COPY examples/ /root/examples
COPY Makefile /root/Makefile
WORKDIR /root/

ENV AWS_PROFILE sandbox
ENV AWS_REGION us-west-2
