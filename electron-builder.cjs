module.exports={
  appId:'org.zphone.preview',productName:'Zphone Preview',executableName:'Zphone-Preview',
  directories:{output:'release/installer'},
  files:['dist/**/*','desktop/**/*','shared/**/*','licenses/**/*','patches/**/*','updates.json','LICENSE','package.json','!**/*.map'],
  extraResources:[{from:'runtime/windows',to:'runtime',filter:['*.exe']}],
  asar:true,
  win:{target:[{target:'nsis',arch:['x64']}],artifactName:'Zphone-Preview-${version}-windows-x64-setup.${ext}',signExecutable:false,requestedExecutionLevel:'requireAdministrator'},
  nsis:{oneClick:false,perMachine:false,allowToChangeInstallationDirectory:true,deleteAppDataOnUninstall:false,runAfterFinish:true,createDesktopShortcut:true,include:'build/installer.nsh',installerLanguages:['en_US','ru_RU']},
  // Metadata is signed locally and published only after a separate manual review.
  publish:{provider:'generic',url:'https://github.com/Spacefok/zphone-releases/releases/download/test/'},
};
