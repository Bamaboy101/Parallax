// Routes /news, /fred and /sec arrive in T14. Until then every path is unknown.
export default {
  fetch(): Response {
    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler;
