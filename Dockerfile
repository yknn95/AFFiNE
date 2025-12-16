#FROM affine-builder:node20.18.0_rustc_1.83 as builder
FROM affine-builder:node22.13_rustc_1.84 as builder

#vim tmp/AFFiNE-0.19.6/blocksuite/affine/block-attachment/src/embed.ts
#html`<video width="100%;" height="100%;" controls src=${blobUrl}></video>`,
COPY /tmp/AFFiNE-0.25.7 /src
# COPY /tmp/AFFiNE_yknn95 /src
WORKDIR /src

RUN mv /node_modules /src/
#RUN yarn config delete https-proxy

#RUN set -ex \
#  && yarn install 
#
#RUN set -ex \
#  && yarn affine @affine/server-native build \
#  && yarn affine @affine/server build \
#  && yarn affine @affine/web build \ 
#  && yarn affine @affine/admin build \
#  && yarn affine @affine/mobile build 
ENV https_proxy http://10.234.4.198:16667
ENV HTTPS_PROXY http://10.234.4.198:16667
RUN yarn install 

#COPY AFFiNE/.git /src/
ENV BUILD_TYPE stable
RUN yarn affine @affine/web build 
RUN yarn affine @affine/admin build 
RUN yarn affine @affine/mobile build 
RUN yarn add tldts 
RUN yarn add htmlrewriter
RUN yarn affine @affine/server build 
#ENV https_proxy "http://10.234.72.114:808"
#ENV HTTPS_PROXY "http://10.234.72.114:808"
RUN yarn affine @affine/server-native build 


#FROM affine-runtime:node20.18.0
FROM affine-runtime:node22.13

COPY --from=builder /src/packages/backend/server /app
COPY --from=builder /src/packages/frontend/apps/web/dist /app/static
COPY --from=builder /src/packages/frontend/admin/dist /app/static/admin
COPY --from=builder /src/packages/frontend/apps/mobile/dist /app/static/mobile
COPY --from=builder /src/packages/backend/native/server-native.node /app

WORKDIR /app

CMD ["node", "--import", "./scripts/register.js", "./dist/index.js"]
