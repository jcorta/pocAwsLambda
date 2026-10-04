// CloudFront Function (viewer-request): resuelve los índices del export estático de Next.js contra el origen S3.
//   /                 → lo resuelve default_root_object
//   /resources/       → /resources/index.html
//   /resources        → /resources/index.html (sin extensión: es una página, no un archivo)
//   /_next/x.js       → sin cambios
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- CloudFront la invoca por su nombre
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  if (uri.endsWith("/")) {
    request.uri = uri + "index.html";
  } else if (uri.lastIndexOf(".") < uri.lastIndexOf("/")) {
    request.uri = uri + "/index.html";
  }
  return request;
}
