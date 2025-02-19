export const SWAGGER_INDEX_HTML = `
<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="UTF-8">
  <title>Microservice API Explorer</title>
  <link rel="stylesheet" type="text/css" href="./swagger-ui.css">
  <link rel="icon" type="image/png" href="./favicon-32x32.png" sizes="32x32" />
  <link rel="icon" type="image/png" href="./favicon-16x16.png" sizes="16x16" />
  <style>
    html {
      box-sizing: border-box;
      overflow: -moz-scrollbars-vertical;
      overflow-y: scroll;
    }

    *,
    *:before,
    *:after {
      box-sizing: inherit;
    }

    body {
      margin: 0;
      background: #fafafa;
    }
  </style>
</head>

<body>
  <div id="swagger-ui"></div>

  <script src="./swagger-ui-bundle.js"> </script>
  <script src="./swagger-ui-standalone-preset.js"> </script>
  <script>
    window.onload = function () {

      // Build a system
      const ui = SwaggerUIBundle({
        url: '/openapi.json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        filter: true,
        defaultModelsExpandDepth: 0,
        defaultModelExpandDepth: 0,
        presets: [
          SwaggerUIBundle.presets.apis,
          // SwaggerUIStandalonePreset
          SwaggerUIStandalonePreset.slice(1) // Disable the top bar
        ],
        plugins: [
          SwaggerUIBundle.plugins.DownloadUrl
        ],
        layout: 'StandaloneLayout'

      })

      window.ui = ui
    }
  </script>
</body>

</html>
`;
