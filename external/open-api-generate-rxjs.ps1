npx @openapitools/openapi-generator-cli generate `
 -i api-docs/reference/SpaceTraders.json `
 -o ../packages/spacetraders-sdk `
 -g typescript-rxjs `
 --additional-properties=npmName="spacetraders-sdk" `
 --additional-properties=npmVersion="2.0.0" `
 --additional-properties=supportsES6=true