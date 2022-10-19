FROM ubuntu:focal
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update
RUN apt-get install -y make curl
RUN dpkg --add-architecture i386
RUN mkdir -pm755 /etc/apt/keyrings
RUN curl https://dl.winehq.org/wine-builds/winehq.key -o /etc/apt/keyrings/winehq-archive.key 
RUN curl https://dl.winehq.org/wine-builds/ubuntu/dists/focal/winehq-focal.sources -o /etc/apt/sources.list.d/winehq-focal.sources
RUN apt update
RUN apt install -yq winehq-stable