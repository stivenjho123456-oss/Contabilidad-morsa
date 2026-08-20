# Recuperar la contraseña

Este proyecto no tiene servidor de correo, asi que no existe el flujo de "te
enviamos un link a tu email". Hay tres caminos, del mas comodo al de ultimo
recurso.

## Camino 0: preguntas de seguridad (desde la propia app)

Es el unico que no necesita acceso a ninguna infraestructura. Cualquiera del
equipo lo puede usar solo.

**Configurarlas primero** (se hace una vez, estando dentro de la app):

1. Barra lateral -> **Preguntas de recuperacion**
2. Elige 3 preguntas del listado o escribe las tuyas
3. Responde cada una y confirma con tu contraseña actual
4. Guardar

Pedir la contraseña actual evita que una sesion olvidada en un equipo ajeno
pueda cambiar las preguntas y quedarse con la cuenta.

**Usarlas cuando olvidaste la contraseña:**

1. En la pantalla de login, **¿Olvidaste tu contraseña?**
2. Escribe tu usuario
3. Responde las 3 preguntas y define la contraseña nueva

Detalles que importan:

- Las respuestas **no distinguen mayusculas ni tildes**: "Bogota", "bogotá" y
  "  BOGOTA " valen igual. Se normalizan antes de compararlas.
- Hay que acertar **todas**. Si falla una, el mensaje no dice cual: decirlo
  convertiria el formulario en una guia para adivinar de a una.
- Tras 5 intentos fallidos la cuenta queda bloqueada 15 minutos, contando **por
  IP y por usuario**. Sin el limite por usuario, alguien rotando de IP podria
  adivinar sin techo.
- Las respuestas se guardan hasheadas con el mismo PBKDF2 de las contraseñas.
  Quien lea la base de datos no puede responder las preguntas.
- Al recuperar se cierran todas las sesiones abiertas de esa cuenta.

Si nunca configuraste preguntas, este camino no esta disponible y hay que usar
los dos siguientes, que exigen acceso al despliegue.

## Los otros dos caminos

Estos son para el dueño del sistema, y sirven aunque no haya preguntas
configuradas. La identidad se prueba con algo equivalente al correo: tener
acceso al panel del hosting o a la base de datos. Cualquiera de las dos cosas ya
implica control total del despliegue.

## Camino 1: variable de entorno (no necesita instalar nada)

Es el camino para "olvide la contraseña y no puedo entrar". Solo necesitas el
panel de Railway.

1. Railway → servicio backend → **Variables**
2. Agrega:

   ```text
   MORSA_PASSWORD_RESET=admin:MiClaveNueva2024
   ```

   El formato es `usuario:ContraseñaNueva`. El primer `:` separa; la contraseña
   puede contener `:` sin problema.

3. Railway redespliega solo al guardar la variable. Espera a que termine.
4. Entra a la aplicacion con la contraseña nueva.
5. **Borra la variable `MORSA_PASSWORD_RESET`.**

El paso 5 no es opcional. Mientras la variable siga definida, cada reinicio del
servicio vuelve a poner esa contraseña. Si mas adelante la cambias por otra, el
siguiente reinicio la revertiria.

Detalles del comportamiento:

- Es idempotente: si la contraseña ya es la pedida, no hace nada y no cierra
  sesiones. Por eso reiniciar el servicio no molesta a nadie.
- Si el usuario no existe, o el formato esta mal, o la contraseña es debil, solo
  queda registrado en los logs. **Nunca tumba el arranque.**
- Al aplicarse cierra todas las sesiones abiertas de ese usuario.
- Queda registrado en la tabla de auditoria como `PASSWORD_RESET`.

En los logs de Railway vas a ver la confirmacion:

```text
WARNING contabilidad_morsa.auth - MORSA_PASSWORD_RESET aplicada para 'admin'.
ELIMINA esa variable del entorno ahora: mientras siga definida, la contraseña
vuelve a este valor en cada reinicio.
```

## Camino 2: script por linea de comandos

Es el camino si prefieres no tocar variables del servicio, o si quieres ver
primero que usuarios existen.

Necesitas la `DATABASE_URL` de la base de produccion y el valor real de
`MORSA_PASSWORD_PEPPER`. Ambos estan en las variables del servicio en Railway.

Ver los usuarios:

```bash
DATABASE_URL="postgresql://..." \
MORSA_PASSWORD_PEPPER="el-pepper-real" \
./.venv/bin/python apps/backend/reset_password.py --listar
```

Restablecer:

```bash
DATABASE_URL="postgresql://..." \
MORSA_PASSWORD_PEPPER="el-pepper-real" \
./.venv/bin/python apps/backend/reset_password.py admin
```

Pide la contraseña por teclado dos veces y no la muestra, asi que no queda en el
historial del shell. Se puede pasar con `--password` para automatizar, pero
entonces si queda registrada.

El script avisa contra que base esta trabajando antes de hacer nada:

```text
Base de datos: PostgreSQL (DATABASE_URL)
```

Si dice `SQLite local` es que te falto exportar `DATABASE_URL` y estarias
cambiando la contraseña de tu base de pruebas, no la de produccion.

## El pepper importa

`MORSA_PASSWORD_PEPPER` entra en el calculo del hash. Si generas la contraseña
con un pepper distinto al que usa el servidor, el hash queda bien guardado pero
el login sigue fallando, sin ningun mensaje que explique por que.

Por eso el script avisa si la variable no esta definida. El camino 1 no tiene
este problema: se ejecuta dentro del propio servidor, con su pepper real.

## Requisitos de la contraseña

Los mismos que en el resto de la aplicacion:

- minimo 10 caracteres
- al menos una minuscula
- al menos una mayuscula
- al menos un numero

Si no se cumplen, el reset se rechaza y la contraseña anterior queda intacta.
