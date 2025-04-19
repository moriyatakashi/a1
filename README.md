cd \myrpa
git clone https://github.com/python/cpython
rd /S /Q cpython2
xcopy /E /I cpython cpython2
\myrpa\cpython2\pcbuild\get_externals.bat
cd \myrpa\cpython2\pcbuild
\myrpa\cpython2\pcbuild\build_env.bat
\myrpa\cpython2\pcbuild\build.bat
