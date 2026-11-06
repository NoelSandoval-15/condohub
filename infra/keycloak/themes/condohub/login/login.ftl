<#import "template.ftl" as layout>
<@layout.registrationLayout displayMessage=!messagesPerField.existsError('username','password') displayInfo=false; section>
    <#if section = "header">
        ${msg("loginAccountTitle")}
    <#elseif section = "form">
        <#if realm.password>
            <form id="kc-form-login" class="ch-formulario" onsubmit="login.disabled = true; return true;" action="${url.loginAction}" method="post">
                <#if !usernameHidden??>
                    <div class="ch-campo">
                        <label for="username"><#if !realm.loginWithEmailAllowed>${msg("username")}<#elseif !realm.registrationEmailAsUsername>${msg("usernameOrEmail")}<#else>${msg("email")}</#if></label>
                        <div class="ch-control">
                            <svg class="ch-icono" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>
                            <input id="username" name="username" value="${(login.username!'')}" type="text" autofocus autocomplete="username" aria-invalid="<#if messagesPerField.existsError('username','password')>true<#else>false</#if>">
                        </div>
                        <#if messagesPerField.existsError('username','password')>
                            <span id="input-error" class="ch-error-campo" role="alert">${kcSanitize(messagesPerField.getFirstError('username','password'))?no_esc}</span>
                        </#if>
                    </div>
                </#if>

                <div class="ch-campo">
                    <label for="password">${msg("password")}</label>
                    <div class="ch-control">
                        <svg class="ch-icono" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
                        <input id="password" name="password" type="password" autocomplete="current-password" aria-invalid="<#if messagesPerField.existsError('username','password')>true<#else>false</#if>">
                        <button class="ch-ver" type="button" aria-controls="password" aria-pressed="false" aria-label="${msg('showPassword')}" data-mostrar="${msg('showPassword')}" data-ocultar="${msg('hidePassword')}">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>
                        </button>
                    </div>
                    <#if usernameHidden?? && messagesPerField.existsError('username','password')>
                        <span id="input-error" class="ch-error-campo" role="alert">${kcSanitize(messagesPerField.getFirstError('username','password'))?no_esc}</span>
                    </#if>
                </div>

                <#if realm.rememberMe && !usernameHidden??>
                    <label class="ch-recordar"><input id="rememberMe" name="rememberMe" type="checkbox"<#if login.rememberMe??> checked</#if>> ${msg("rememberMe")}</label>
                </#if>

                <p class="ch-nota">${msg("chAyudaModulo")}</p>

                <input type="hidden" id="id-hidden-input" name="credentialId"<#if auth.selectedCredential?has_content> value="${auth.selectedCredential}"</#if>>
                <button class="ch-principal" name="login" id="kc-login" type="submit">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5 10 17.5 19 7"/></svg>
                    ${msg("doLogIn")}
                </button>

                <#if realm.resetPasswordAllowed>
                    <a class="ch-ayuda" href="${url.loginResetCredentialsUrl}">${msg("doForgotPassword")}</a>
                <#else>
                    <p class="ch-ayuda">${msg("chAyudaContrasena")}</p>
                </#if>
            </form>
            <script src="${url.resourcesPath}/js/contrasena.js" defer></script>
        </#if>
    <#elseif section = "socialProviders">
        <#if realm.password && social?? && social.providers?has_content>
            <ul class="ch-proveedores">
                <#list social.providers as p>
                    <li><a id="social-${p.alias}" href="${p.loginUrl}">${p.displayName!}</a></li>
                </#list>
            </ul>
        </#if>
    </#if>
</@layout.registrationLayout>
