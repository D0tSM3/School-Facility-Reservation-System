import re

with open(r"D:\XAMPP\php\php.ini", "r", encoding="utf-8") as f:
    ini = f.read()

ini = ini.replace(";extension=pdo_pgsql", "extension=pdo_pgsql")
ini = ini.replace(";extension=pgsql", "extension=pgsql")

with open(r"D:\XAMPP\php\php.ini", "w", encoding="utf-8") as f:
    f.write(ini)
