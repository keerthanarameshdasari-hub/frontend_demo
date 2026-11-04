source 'https://rubygems.org'

# You may use http://rbenv.org/ or https://rvm.io/ to install and use this version
ruby ">= 2.6.10"

# Exclude problematic versions of cocoapods and activesupport that causes build failures.
gem 'cocoapods', '>= 1.13', '!= 1.15.0', '!= 1.15.1'
gem 'xcodeproj', '< 1.29.0'
# The React Native template pins concurrent-ruby < 1.3.4 because 1.3.5 broke ActiveSupport
# older than 7.1. That range has a high-severity advisory (GHSA-h8w8-99g7-qmvj, fixed in
# 1.3.7), so require the fixed version and an ActiveSupport that works with it instead.
gem 'activesupport', '>= 7.1.1'
gem 'concurrent-ruby', '>= 1.3.7'

# Ruby 3.4.0 has removed some libraries from the standard library.
gem 'bigdecimal'
gem 'logger'
gem 'benchmark'
gem 'mutex_m'
gem 'nkf'
