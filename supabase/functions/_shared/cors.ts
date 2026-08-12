// `*` is safe here specifically because this function never relies on
// cookies/ambient credentials — the caller's identity, when there is one,
// comes from an explicit Bearer token, and the response itself carries no
// session state. There's nothing for a cross-origin page to steal by
// riding a user's browser to this endpoint.
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
