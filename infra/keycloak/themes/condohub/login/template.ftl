<#-- Marco visual de todas las páginas de login. Conserva el contrato de la plantilla base de Keycloak 25. -->
<#macro registrationLayout bodyClass="" displayInfo=false displayMessage=true displayRequiredFields=false>
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex, nofollow">
    <title>${msg("loginTitle",(realm.displayName!''))}</title>
    <#list properties.styles?split(' ') as style>
        <link href="${url.resourcesPath}/${style}" rel="stylesheet">
    </#list>
    <#if scripts??>
        <#list scripts as script>
            <script src="${script}" type="text/javascript"></script>
        </#list>
    </#if>
    <script type="module">
        import { checkCookiesAndSetTimer } from "${url.resourcesPath}/js/authChecker.js";
        checkCookiesAndSetTimer("${url.ssoLoginInOtherTabsUrl?no_esc}");
    </script>
</head>
<body>
<main class="ch-tarjeta">
    <header class="ch-cabecera">
        <span class="ch-logo" aria-hidden="true">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v17M3 21h18M9 7h1.5M13.5 7H15M9 11h1.5M13.5 11H15M9 15h1.5M13.5 15H15M10.5 21v-3h3v3"/></svg>
        </span>
        <#if !(auth?has_content && auth.showUsername() && !auth.showResetCredentials())>
            <h1 id="kc-page-title"><#nested "header"></h1>
        <#else>
            <#nested "show-username">
            <div id="kc-username" class="ch-usuario-intentado">
                <span id="kc-attempted-username">${auth.attemptedUsername}</span>
                <a id="reset-login" href="${url.loginRestartFlowUrl}">${msg("restartLoginTooltip")}</a>
            </div>
        </#if>
        <p class="ch-subtitulo">${msg("chSubtitulo")}</p>
    </header>

    <#if displayMessage && message?has_content && (message.type != 'warning' || !isAppInitiatedAction??)>
        <div class="ch-alerta ch-alerta--${message.type}" role="alert">${kcSanitize(message.summary)?no_esc}</div>
    </#if>

    <#nested "form">

    <#if auth?has_content && auth.showTryAnotherWayLink()>
        <form id="kc-select-try-another-way-form" action="${url.loginAction}" method="post">
            <input type="hidden" name="tryAnotherWay" value="on">
            <button class="ch-enlace" type="submit" id="try-another-way">${msg("doTryAnotherWay")}</button>
        </form>
    </#if>

    <#nested "socialProviders">

    <#if displayInfo>
        <div id="kc-info" class="ch-info"><#nested "info"></div>
    </#if>

    <footer class="ch-pie">${msg("chPie")}</footer>
</main>
</body>
</html>
</#macro>
